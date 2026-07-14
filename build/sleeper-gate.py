#!/usr/bin/env python3
"""
5-minute gate for the football build. Runs the full data refresh only when the
current time falls inside an NFL "hot" window (a 12-hour ET half-day containing a
game), per /boot/config/nfl_hot_windows.json. Outside game windows it does
nothing — the every-6-hours baseline cron keeps the site current.
"""
import json, os, subprocess, sys
from datetime import datetime, timezone

WINDOWS = os.environ.get("SC_WINDOWS_FILE", "/boot/config/nfl_hot_windows.json")
BUILD   = os.environ.get("SC_BUILD_SCRIPT", "/boot/config/sleeper-update.py")
LOG     = os.environ.get("SC_LOG_FILE", "/var/log/sleeper-update.log")

try:
    data = json.load(open(WINDOWS))
except Exception:
    sys.exit(0)   # no schedule yet -> baseline cron still covers refreshes

now = datetime.now(timezone.utc)
hot = any(datetime.fromisoformat(s) <= now < datetime.fromisoformat(e)
          for s, e in data.get("windows", []))
if not hot:
    sys.exit(0)

with open(LOG, "a") as lf:
    lf.write(f"\n[gate] {now.isoformat()} in NFL hot window -> fast refresh\n")
    env = dict(os.environ, SC_FAST="1")   # reuse cached completed seasons
    subprocess.run(["/usr/bin/python3", BUILD], stdout=lf, stderr=subprocess.STDOUT, env=env)
