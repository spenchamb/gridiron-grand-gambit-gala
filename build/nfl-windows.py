#!/usr/bin/env python3
"""
Build the list of "hot" 12-hour windows when the football data should refresh
every 5 minutes — each ET half-day (00:00-12:00 or 12:00-24:00 Eastern) that
contains at least one real NFL kickoff. Uses the actual released schedule
(Sleeper for game dates, ESPN for exact kickoff times), so it self-corrects for
flex scheduling. Writes /boot/config/nfl_hot_windows.json. Run weekly + once now.

This file is the whole in-game refresh cadence: an empty windows list means the
gate never fires and the site runs the entire season on its 6-hourly baseline.
It has failed that way once already — ESPN's `site.api` host began 403ing our
User-Agent, every kickoff lookup returned nothing, and the run cheerfully wrote
`0 windows` over a good file on 2026-09-08, a day before kickoff. Hence three
rules here, in order of preference:

  1. exact kickoff times, from whichever ESPN host answers (see KICKOFF_URLS);
  2. failing that, both half-days of every date Sleeper says has a game — a
     blunter window that still refreshes during every game;
  3. failing even that, write NOTHING and exit non-zero, leaving the last good
     file in place.

Writing an empty schedule is never correct, so it is not a reachable outcome.
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

ET  = ZoneInfo("America/New_York")
OUT = os.environ.get("SC_WINDOWS_FILE", "/boot/config/nfl_hot_windows.json")

def fetch(url, ua="scbeelink-nfl/1.0"):
    """`ua=None` sends no User-Agent at all, which is the only thing some ESPN
       hosts will accept from us — see KICKOFF_URLS."""
    req = urllib.request.Request(url, headers={"User-Agent": ua} if ua else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# Two ESPN hosts carrying the same scoreboard, tried in this order.
#
#   site.api   honours `dates` — the only host that answers for an arbitrary
#              date in December. It 403s a request carrying our User-Agent and
#              serves the identical payload to one that sends none, which is the
#              trap that emptied this file: `ua=None` is load-bearing, not tidy.
#   cdn.espn   answers whatever UA you send, but IGNORES `dates` and always
#              returns the current week's slate. Useful only as a stand-in for
#              the current week, so its events are filtered to the date actually
#              asked for; without that filter it reports week 1's sixteen games
#              fifty-seven times over.
KICKOFF_URLS = [
    ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={ymd}", None),
    ("https://cdn.espn.com/core/nfl/scoreboard?xhr=1&dates={ymd}", "scbeelink-nfl/1.0"),
]


def kickoffs_for(ymd):
    """Kickoff datetimes for one YYYYMMDD (UTC), or [] if no host answered."""
    for tmpl, ua in KICKOFF_URLS:
        try:
            doc = fetch(tmpl.format(ymd=ymd), ua=ua)
        except Exception:
            continue
        # cdn.espn nests the scoreboard; site.api returns it at the top level.
        events = (doc.get("events")
                  or ((doc.get("content") or {}).get("sbData") or {}).get("events")
                  or [])
        out = []
        for ev in events:
            try:
                k = datetime.fromisoformat(str(ev.get("date")).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                continue
            # Trust the host only for the date requested — see cdn.espn above.
            # Compared in ET, because that is what `dates=` means to ESPN and
            # what Sleeper's schedule dates are: a Thursday 8:20pm kickoff is
            # already the next day in UTC, and matching on UTC silently dropped
            # every night game.
            if k.astimezone(ET).strftime("%Y%m%d") == ymd:
                out.append(k)
        if out:
            return out
    return []

# Current NFL season (rollover-proof), fallback 2026
try:
    season = int((fetch("https://api.sleeper.app/v1/state/nfl") or {}).get("season") or 2026)
except Exception:
    season = 2026

# 1. distinct game dates from Sleeper's schedule (regular season)
try:
    sched = fetch(f"https://api.sleeper.app/schedule/nfl/regular/{season}") or []
except Exception as e:
    print(f"! sleeper schedule failed: {e}", file=sys.stderr); sys.exit(1)
dates = sorted(set(g["date"] for g in sched if g.get("date")))

# 2. exact kickoff UTC datetimes per date from ESPN
kickoffs = []
for d in dates:
    kickoffs.extend(kickoffs_for(d.replace("-", "")))

# 3. bucket each kickoff into its ET half-day; one UTC window per distinct half
halves = set()
for k in kickoffs:
    et = k.astimezone(ET)
    halves.add((et.year, et.month, et.day, 0 if et.hour < 12 else 1))

source = "kickoffs"
if not halves:
    # Rule 2: no kickoff times, but Sleeper's dates are trustworthy. Both halves
    # of a game day is twice the hot time and none of the missed refreshes --
    # far and away the better failure, and it needs no second service.
    source = "dates-only"
    print("! no kickoff times from ESPN; falling back to whole game days",
          file=sys.stderr)
    for d in dates:
        y, m, dd = (int(x) for x in d.split("-"))
        halves.add((y, m, dd, 0))
        halves.add((y, m, dd, 1))

if not halves:
    # Rule 3: the schedule itself is unusable. Keep whatever is on disk.
    print(f"! no windows derivable ({len(dates)} dates, {len(kickoffs)} kickoffs); "
          f"leaving {OUT} untouched", file=sys.stderr)
    sys.exit(1)

windows = []
for (y, m, dd, half) in sorted(halves):
    start_et = datetime(y, m, dd, 0 if half == 0 else 12, 0, tzinfo=ET)
    end_et   = start_et + timedelta(hours=12)
    windows.append([start_et.astimezone(timezone.utc).isoformat(),
                    end_et.astimezone(timezone.utc).isoformat()])

payload = {
    "generated": datetime.now(timezone.utc).isoformat(),
    "season": season,
    "source": source,          # "kickoffs" (exact) or "dates-only" (degraded)
    "kickoffs": len(kickoffs),
    "dates": len(dates),
    "count": len(windows),
    "windows": windows,
}
tmp = OUT + ".tmp"
json.dump(payload, open(tmp, "w"), indent=1)
import os; os.replace(tmp, OUT)
print(f"wrote {len(windows)} hot windows [{source}] from {len(kickoffs)} kickoffs "
      f"across {len(dates)} dates (season {season})")
