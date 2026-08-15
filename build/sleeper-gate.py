#!/usr/bin/env python3
"""
5-minute gate for the football build. Runs the full data refresh when either:

  * the current time falls inside an NFL "hot" window (a 12-hour ET half-day
    containing a game), per /boot/config/nfl_hot_windows.json; or
  * the league's draft is actually underway.

Outside both, it does nothing — the every-6-hours baseline cron keeps the site
current.

The draft check exists because a draft is started by hand whenever the
commissioner feels like it, so there is no window to precompute: nfl-windows.py
only knows about games, and in August it legitimately produces no windows at
all. Without this, a draft that starts at 1pm would not reach the league site
until the next baseline run hours later.
"""
import json, os, subprocess, sys, urllib.request
from datetime import datetime, timezone

WINDOWS = os.environ.get("SC_WINDOWS_FILE", "/boot/config/nfl_hot_windows.json")
BUILD   = os.environ.get("SC_BUILD_SCRIPT", "/boot/config/sleeper-update.py")
LOG     = os.environ.get("SC_LOG_FILE", "/var/log/sleeper-update.log")
OUT_DIR = os.environ.get("SC_OUT_DIR", "/mnt/cache/appdata/www-data/sleeper/data")

now = datetime.now(timezone.utc)

try:
    data = json.load(open(WINDOWS))
except Exception:
    data = {}     # no schedule yet -> fall through to the draft check

hot = any(datetime.fromisoformat(s) <= now < datetime.fromisoformat(e)
          for s, e in data.get("windows", []))
reason = "in NFL hot window"


def draft_live():
    """True while the current league's draft is running.

    Every failure path returns False: this is a supplementary trigger, and the
    baseline cron is still there. A Sleeper hiccup must never take the gate down
    with it, so the whole thing is wrapped rather than allowed to raise into a
    cron job nobody is watching.
    """
    for lid in _league_ids():
        try:
            req = urllib.request.Request(
                f"https://api.sleeper.app/v1/league/{lid}/drafts",
                headers={"User-Agent": "scbeelink-gate/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                drafts = json.loads(r.read().decode("utf-8", errors="replace"))
            if any(d.get("status") == "drafting" for d in (drafts or [])):
                return True
        except Exception:
            continue
    return False


def _league_ids():
    """League ids that might be drafting, upcoming season first.

    meta.json's current_league_id is NOT enough on its own. The builder's
    resolve_current_league() deliberately keeps pointing at the last COMPLETED
    season until the new one starts drafting, so on draft morning it still names
    last year's league — whose draft is 'complete'. The league that is about to
    draft is the one preseason.json describes, so that one is checked first.
    """
    out = []
    for fname, key in (("preseason.json", "league_id"),
                       ("meta.json", "current_league_id")):
        try:
            lid = json.load(open(os.path.join(OUT_DIR, fname))).get(key)
            if lid and lid not in out:
                out.append(lid)
        except Exception:
            continue
    return out


if not hot:
    if draft_live():
        reason = "league draft in progress"
    else:
        sys.exit(0)

with open(LOG, "a") as lf:
    lf.write(f"\n[gate] {now.isoformat()} {reason} -> fast refresh\n")
    env = dict(os.environ, SC_FAST="1")   # reuse cached completed seasons
    subprocess.run(["/usr/bin/python3", BUILD], stdout=lf, stderr=subprocess.STDOUT, env=env)
