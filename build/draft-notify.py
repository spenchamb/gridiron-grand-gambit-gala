#!/usr/bin/env python3
"""
draft-notify.py  —  pushes draft alerts to the phone via ntfy while a draft is live.

Runs from cron once a minute and polls every POLL seconds for ~55s before exiting,
so the next cron run picks up seamlessly. That gives 5-second resolution with
cron's reliability and no long-lived daemon to babysit.

Why this lives on the server and not in the War Room page: a browser tab cannot be
relied on to fire a notification when the phone is locked or the tab is backgrounded
— which is precisely when you need to be told you're on the clock. This process does
not care what your phone is doing.

Sends two alerts per pick cycle, each at most once (state file dedupes):
  * ON THE CLOCK  — top 3 available at all six positions, plus tier-cliff warnings
  * HEADS UP      — fired 2 picks out so there's time to think

Watches every LEAGUE draft on the account automatically. Mock drafts cannot be
discovered — Sleeper's /user/<id>/drafts endpoint returns league drafts only
(verified across 2026, 2025 and 2024) and there is no endpoint that lists mocks
— so a mock has to be named explicitly, either in SC_DRAFT_IDS or one id per
line in the watch file (default /boot/config/draft-watch.txt):

    echo 1234567890123456789 >> /boot/config/draft-watch.txt

A watch line may pin the draft slot as "<id>:<slot>" for mocks where Sleeper
doesn't report which seat is yours:

    echo 1234567890123456789:3 >> /boot/config/draft-watch.txt

SC_DRAFT_SLOT sets a default slot for any draft whose seat can't be resolved.
Ids are dropped from the watch file automatically once that draft completes, so
it doesn't accumulate dead mocks.

Env:
  SC_WARROOM_OUT   dir holding board.json   (default /mnt/cache/appdata/www-data/warroom/data)
  SC_DRAFT_USER    Sleeper username         (default footspencerball)
  SC_NTFY_TOPIC    ntfy topic               (default homelab — the one already subscribed)
  SC_NOTIFY_SH     notify helper            (default /boot/config/notify.sh)
  SC_DRAFT_STATE   dedupe state file        (default /boot/config/draft-notify.state)
  SC_DRAFT_ONCE    set to 1 for a single pass (testing)
"""
import json, os, sys, time, urllib.request, urllib.error, subprocess, datetime

API      = "https://api.sleeper.app/v1"
OUT_DIR  = os.environ.get("SC_WARROOM_OUT", "/mnt/cache/appdata/www-data/warroom/data")
USER     = os.environ.get("SC_DRAFT_USER", "footspencerball")
TOPIC    = os.environ.get("SC_NTFY_TOPIC", "homelab")
NOTIFY   = os.environ.get("SC_NOTIFY_SH", "/boot/config/notify.sh")
STATE    = os.environ.get("SC_DRAFT_STATE", "/boot/config/draft-notify.state")
WATCH    = os.environ.get("SC_DRAFT_WATCH", "/boot/config/draft-watch.txt")
EXTRA    = [x.strip() for x in os.environ.get("SC_DRAFT_IDS", "").split(",") if x.strip()]
DEF_SLOT = int(os.environ.get("SC_DRAFT_SLOT", "3") or 0) or None
ONCE     = os.environ.get("SC_DRAFT_ONCE") == "1"

POLL      = 5      # seconds between checks — matches the War Room page
RUN_FOR   = 55     # exit before the next cron run starts
HEADS_UP  = 2      # picks before your turn to send the early warning
UA        = {"User-Agent": "scbeelink-draftnotify/1.0"}
POSES     = ["QB", "RB", "WR", "TE", "K", "DEF"]


def log(*a):
    print(datetime.datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def jget(url, bust=False):
    """Sleeper edge-caches picks for 30s; a unique param forces a fresh origin
    read, which is the difference between 5s alerts and 30s alerts."""
    if bust:
        url += ("&" if "?" in url else "?") + "_=" + str(int(time.time() * 1000))
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=12) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        log("  ! fetch failed:", url.split("?")[0], e)
        return None


def load_state():
    try:
        with open(STATE) as f:
            return set(json.load(f))
    except Exception:
        return set()


def save_state(s):
    # Keep it bounded; only recent keys matter and drafts are short-lived.
    try:
        with open(STATE, "w") as f:
            json.dump(sorted(s)[-500:], f)
    except Exception as e:
        log("  ! could not write state:", e)


def watch_ids():
    """Explicitly-watched drafts (mocks). Returns {draft_id: pinned_slot_or_None}.
    Lines are "<id>" or "<id>:<slot>"; SC_DRAFT_IDS accepts the same forms."""
    out = {}

    def take(tok):
        tok = tok.strip()
        if not tok or tok.startswith("#"):
            return
        did, _, slot = tok.partition(":")
        did, slot = did.strip(), slot.strip()
        if did.isdigit():
            out[did] = int(slot) if slot.isdigit() else None

    for t in EXTRA:
        take(t)
    try:
        with open(WATCH) as f:
            for line in f:
                take(line)
    except FileNotFoundError:
        pass
    except Exception as e:
        log("  ! watch file unreadable:", e)
    return out


def prune_watch(done):
    """Drop completed drafts so the file doesn't accumulate dead mocks."""
    try:
        with open(WATCH) as f:
            keep = [l for l in f if l.strip() not in done]
        with open(WATCH, "w") as f:
            f.writelines(keep)
        log("  pruned finished draft(s) from watch:", ",".join(done))
    except FileNotFoundError:
        pass
    except Exception as e:
        log("  ! could not prune watch file:", e)


def push(title, message, priority="high", tags="football"):
    try:
        subprocess.run(["bash", NOTIFY, title, message, priority, tags, TOPIC],
                       check=False, timeout=20)
        log("  push:", title)
    except Exception as e:
        log("  ! push failed:", e)


def slot_for_pick(overall, teams):
    r = -(-overall // teams)                 # ceil
    i = overall - (r - 1) * teams
    return i if r % 2 == 1 else teams - i + 1


def picks_for_slot(slot, teams, rounds):
    out = []
    for r in range(1, rounds + 1):
        i = slot if r % 2 == 1 else teams - slot + 1
        out.append((r, (r - 1) * teams + i))
    return out


def load_board():
    try:
        with open(os.path.join(OUT_DIR, "board.json")) as f:
            return json.load(f)
    except Exception as e:
        log("! no board.json —", e)
        return None


def roster_info(league_id, uid):
    """Returns (kept_pids, my_roster_id).

    Uses roster["keepers"], NOT roster["players"]: before a draft Sleeper still
    reports last season's full rosters (185 players in this league against 12
    real keepers), so subtracting players would strip the board of everyone
    actually draftable. `keepers` is null in a non-keeper league, which is
    correctly an empty set."""
    if not league_id:
        return set(), None
    rs = jget(f"{API}/league/{league_id}/rosters") or []
    out, mine = set(), None
    for r in rs:
        for p in (r.get("keepers") or []):
            out.add(str(p))
        if str(r.get("owner_id")) == str(uid):
            mine = r.get("roster_id")
    return out, mine


def my_slot_for(info, uid, my_roster_id):
    """draft_order is null until Sleeper actually sets the order — often not
    until the draft starts — so fall back to the slot->roster mapping, which is
    populated far earlier. Without this we'd skip a draft you're really in."""
    order = info.get("draft_order") or {}
    slot = order.get(str(uid)) or order.get(uid)
    if slot:
        return slot
    if my_roster_id is not None:
        s2r = info.get("slot_to_roster_id") or {}
        for k, v in s2r.items():
            if str(v) == str(my_roster_id):
                return int(k)
    return None


def build_message(board, taken, need_counts):
    """Top 3 available at every position, plus a cliff warning where a tier is
    about to empty. All six positions every time, by request."""
    lines, cliffs = [], []
    for pos in POSES:
        left = [p for p in board["players"] if p["pos"] == pos and str(p["pid"]) not in taken]
        if not left:
            continue
        top = left[:3]
        lines.append(f"{pos}: " + ", ".join(
            f"{p['name'].split(' D/ST')[0]}" + (f" #{p['rank']}" if p.get("rank") else "")
            for p in top))
        t = left[0].get("tier")
        if t is not None and pos in ("QB", "RB", "WR", "TE"):
            n = sum(1 for p in left if p.get("tier") == t)
            if n <= 2:
                cliffs.append(f"{pos} tier {t}: {n} left")
    msg = "\n".join(lines)
    if cliffs:
        msg += "\n\n⚠ " + " · ".join(cliffs)
    return msg


def check(board, state, uid):
    """Returns True if at least one live draft was seen this cycle."""
    season = board.get("season") or str(datetime.date.today().year)
    drafts = jget(f"{API}/user/{uid}/drafts/nfl/{season}", bust=True) or []

    # Mocks aren't discoverable, so pull any explicitly-watched ids individually.
    seen = {str(d.get("draft_id")) for d in drafts}
    watched = watch_ids()
    finished = []
    for did, pin in watched.items():
        if did in seen:
            continue
        d = jget(f"{API}/draft/{did}", bust=True)
        if not d or not d.get("draft_id"):
            continue
        if d.get("status") == "complete":
            finished.append(did)      # prune so the watch file stays current
            continue
        drafts.append(d)
    if finished:
        prune_watch(finished)

    live = [d for d in drafts if d.get("status") == "drafting"]
    if not live:
        return False

    for d in live:
        did = str(d.get("draft_id"))
        info = jget(f"{API}/draft/{did}", bust=True) or d
        s = info.get("settings") or {}
        teams, rounds = s.get("teams") or 12, s.get("rounds") or 15
        locked, my_roster_id = roster_info(d.get("league_id"), uid)
        # Precedence: slot pinned for this draft > what Sleeper reports > the
        # SC_DRAFT_SLOT default. A mock you joined often reports nothing.
        my_slot = watched.get(did) or my_slot_for(info, uid, my_roster_id) or DEF_SLOT
        if not my_slot or my_slot > teams:
            continue                      # spectating someone else's draft

        picks = jget(f"{API}/draft/{did}/picks", bust=True)
        if picks is None:
            continue
        nxt = len(picks) + 1
        if nxt > teams * rounds:
            continue

        mine = [ov for _r, ov in picks_for_slot(my_slot, teams, rounds) if ov >= nxt]
        my_next = mine[0] if mine else None
        if my_next is None:
            continue
        away = my_next - nxt

        if away not in (0, HEADS_UP):
            continue
        key = f"{did}:{my_next}:{'clock' if away == 0 else 'heads'}"
        if key in state:
            continue

        taken = {str(p.get("player_id")) for p in picks} | locked
        body = build_message(board, taken, None)
        name = (d.get("metadata") or {}).get("name") or ("Mock draft" if not d.get("league_id") else "Draft")
        rnd = -(-my_next // teams)

        if away == 0:
            push(f"🏈 ON THE CLOCK — pick {my_next} (R{rnd})",
                 f"{name}\n\n{body}", "high", "football,rotating_light")
        else:
            push(f"⏳ {HEADS_UP} picks away — you're up at {my_next}",
                 f"{name}\n\n{body}", "high", "hourglass")
        state.add(key)
        save_state(state)
    return True


def main():
    board = load_board()
    if not board:
        sys.exit(0)

    # Resolve the user once — it never changes, and this runs every minute.
    user = jget(f"{API}/user/{USER}")
    if not user or not user.get("user_id"):
        log("! could not resolve user", USER)
        sys.exit(0)
    uid = str(user["user_id"])

    state = load_state()
    deadline = time.time() + RUN_FOR
    while True:
        live = False
        try:
            live = check(board, state, uid)
        except Exception as e:
            log("! check error:", e)     # never let one bad cycle kill the run
        # Nothing drafting: stop immediately rather than burning 5s polls for the
        # rest of the minute. Cron re-runs us in 60s, so a draft is picked up
        # within a minute of starting — but the other 364 days cost 2 calls/min
        # instead of 22.
        if not live or ONCE or time.time() + POLL > deadline:
            break
        time.sleep(POLL)


if __name__ == "__main__":
    main()
