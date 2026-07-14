#!/usr/bin/env python3
"""
Build the list of "hot" 12-hour windows when the football data should refresh
every 5 minutes — each ET half-day (00:00-12:00 or 12:00-24:00 Eastern) that
contains at least one real NFL kickoff. Uses the actual released schedule
(Sleeper for game dates, ESPN for exact kickoff times), so it self-corrects for
flex scheduling. Writes /boot/config/nfl_hot_windows.json. Run weekly + once now.
"""
import json, sys, urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

ET  = ZoneInfo("America/New_York")
OUT = "/boot/config/nfl_hot_windows.json"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "scbeelink-nfl/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

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
    ymd = d.replace("-", "")
    try:
        sb = fetch(f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={ymd}")
    except Exception:
        continue
    for ev in (sb.get("events") or []):
        try:
            kickoffs.append(datetime.fromisoformat(ev["date"].replace("Z", "+00:00")))
        except Exception:
            pass

# 3. bucket each kickoff into its ET half-day; one UTC window per distinct half
halves = set()
for k in kickoffs:
    et = k.astimezone(ET)
    halves.add((et.year, et.month, et.day, 0 if et.hour < 12 else 1))

windows = []
for (y, m, dd, half) in sorted(halves):
    start_et = datetime(y, m, dd, 0 if half == 0 else 12, 0, tzinfo=ET)
    end_et   = start_et + timedelta(hours=12)
    windows.append([start_et.astimezone(timezone.utc).isoformat(),
                    end_et.astimezone(timezone.utc).isoformat()])

payload = {
    "generated": datetime.now(timezone.utc).isoformat(),
    "season": season,
    "kickoffs": len(kickoffs),
    "count": len(windows),
    "windows": windows,
}
tmp = OUT + ".tmp"
json.dump(payload, open(tmp, "w"), indent=1)
import os; os.replace(tmp, OUT)
print(f"wrote {len(windows)} hot windows from {len(kickoffs)} kickoffs across {len(dates)} dates (season {season})")
