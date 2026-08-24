#!/usr/bin/env python3
"""
Cadence gate for ffpros-api.py, modelled on sleeper-gate.py.

Runs on the 5-minute cron and decides whether it is worth spending calls yet.
The FantasyPros allowance is 50 a day, which is a real constraint, so the
spacing is deliberately uneven: projections move all Sunday morning as inactives
land, and barely at all on a Wednesday night.

    inside an NFL hot window   a live refresh every 45 min   (2 calls)
    outside one                a live refresh every 6 hours  (2 calls)
    once a day                 a full refresh                (4 calls)

Worst case is a twelve-hour Sunday: 16 live refreshes plus one full run, which
is 36 of the 50. The remainder is headroom for a manual run or a retry after an
outage — ffpros-api.py enforces its own soft cap regardless, so a bug here
cannot overspend the account, only waste the day's budget.

The hot-window file is the same one sleeper-gate.py reads, produced by
nfl-windows.py, so game-day cadence stays in one place.
"""
import json, os, subprocess, sys
from datetime import datetime, timedelta, timezone

WINDOWS   = os.environ.get("SC_WINDOWS_FILE", "/boot/config/nfl_hot_windows.json")
BUILD     = os.environ.get("SC_FFPROS_SCRIPT", "/boot/config/ffpros-api.py")
STATE_DIR = os.environ.get("SC_STATE_DIR", "/mnt/cache/appdata/ffb-state")
STAMP     = os.path.join(STATE_DIR, "fp_last_run.json")

HOT_MINUTES  = int(os.environ.get("FFPROS_HOT_MINUTES", "45"))
COLD_MINUTES = int(os.environ.get("FFPROS_COLD_MINUTES", "360"))

now = datetime.now(timezone.utc)

try:
    windows = json.load(open(WINDOWS)).get("windows", [])
except Exception:
    windows = []

hot = any(
    datetime.fromisoformat(s) <= now < datetime.fromisoformat(e)
    for s, e in windows
)

try:
    with open(STAMP) as f:
        stamp = json.load(f)
except Exception:
    stamp = {}


def parse(ts):
    try:
        return datetime.fromisoformat(ts)
    except Exception:
        return None


last_any = parse(stamp.get("last_any") or "")
last_full = parse(stamp.get("last_full") or "")

# One full refresh per calendar day (UTC), taken at the first opportunity —
# which during the season is the first hot window, so the rest-of-season numbers
# are refreshed alongside the weekly ones rather than at some arbitrary hour.
need_full = last_full is None or last_full.date() < now.date()

gap = timedelta(minutes=HOT_MINUTES if hot else COLD_MINUTES)
due = last_any is None or (now - last_any) >= gap

if not (need_full or due):
    sys.exit(0)

mode = "full" if need_full else "live"
reason = "hot window" if hot else "baseline"

rc = subprocess.call(
    [sys.executable, BUILD, f"--mode={mode}"],
    stdout=sys.stdout, stderr=sys.stderr,
)

# Only a success moves the clock. A failed run should be retried on the next
# tick, not suppressed for another 45 minutes — but a budget refusal (4) is not
# a failure to retry, it is the cap working, so that stamps too.
if rc in (0, 4):
    os.makedirs(STATE_DIR, exist_ok=True)
    stamp["last_any"] = now.isoformat()
    if mode == "full" and rc == 0:
        stamp["last_full"] = now.isoformat()
    tmp = STAMP + ".tmp"
    with open(tmp, "w") as f:
        json.dump(stamp, f)
    os.replace(tmp, STAMP)

print(f"ffpros-gate: {mode} refresh ({reason}) exit={rc}")
sys.exit(0 if rc in (0, 4) else rc)
