#!/usr/bin/env python3
"""
ffpros-api.py — FantasyPros official API v2 producer for the GGGG site.

Replaces Sleeper's projection feed as the forward-looking source of truth. This
writes a cache (data/fp.json); it is NOT read by the front end directly. The two
existing builders read the cache and fall back to Sleeper when it is missing or
stale, so a bad key or an exhausted budget degrades to today's behaviour rather
than to an empty site.

WHY A SEPARATE BUILDER
The site's cron runs every five minutes. The API allows 50 calls a day. Those
two facts cannot live in the same script, so this one owns the entire API
relationship: it is the only thing holding the key, the only thing that spends
calls, and it refuses to spend more than the cap no matter how often it is run.

CALL BUDGET
position=ALL works on both endpoints, so a full refresh is four calls:

    consensus-rankings  type=WW   week=N   scoring=PPR    weekly ECR
    consensus-rankings  type=ROS           scoring=PPR    rest-of-season ECR
    projections         week=N                            weekly stat lines
    projections         ros=true                          rest-of-season lines

Two of those are rest-of-season and barely move between kickoffs, while the two
weekly ones move all Sunday morning as inactives land. So there are two modes:

    --mode full   all four. Once a day.
    --mode live   the two weekly calls, merged onto the existing cache. Every
                  45-60 minutes inside an NFL window.

That split is what makes game-day freshness affordable. A twelve-hour Sunday at
45-minute intervals costs 16x2 = 32 calls, plus one full refresh, and still
lands under the cap — where refreshing everything each time would need 64 and
blow through it before the late games.

Everything else it needs — the league's scoring rules, the Sleeper player DB,
the FantasyPros->Sleeper id crosswalk — is free and unmetered, so none of it
counts against the cap.

SCORING
The projections endpoint has no scoring parameter: it returns raw stat lines.
That is an improvement on Sleeper's pre-scored numbers, because this league is
not standard PPR-with-nothing-else — it pays 0.1/yd over 30 on field goals,
penalises missed kicks by distance, and scores defenses on points allowed AND
yards allowed. Those rules are applied here, from the league's own
scoring_settings, so a projection means the same thing the box score will.

Coverage is measured rather than assumed. FantasyPros does not project every
stat this league scores (nobody projects "3 and outs"), so score_line() reports
which scoring keys it could not fill. Positions whose coverage is too thin to
trust are listed in the output as `low_confidence` for the consumers to ignore.

KEY
FFPROS_API_KEY, from /boot/config/ffpros.env. Never in the repo, never logged.
"""
import csv, datetime, io, json, os, re, sys, time, unicodedata
import urllib.error, urllib.parse, urllib.request

FP_BASE   = "https://api.fantasypros.com/public/v2/json"
SLEEPER   = "https://api.sleeper.app/v1"
IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"

OUT_DIR   = os.environ.get("SC_OUT_DIR", "/mnt/cache/appdata/www-data/sleeper/data")
STATE_DIR = os.environ.get("SC_STATE_DIR", "/mnt/cache/appdata/ffb-state")
API_KEY   = os.environ.get("FFPROS_API_KEY", "").strip()

DAILY_CAP = int(os.environ.get("FFPROS_DAILY_CAP", "50"))
# Leave room for a manual run or a retry after an outage; the cap is a hard
# ceiling on the account, not a target to spend to.
SOFT_CAP  = int(os.environ.get("FFPROS_SOFT_CAP", "44"))

UA = {"User-Agent": "scbeelink-ffpros-api/1.0"}

# FantasyPros team code -> Sleeper DEF pid, where they differ.
TEAM_ALIAS = {"JAC": "JAX", "WSH": "WAS", "LA": "LAR"}


# ── budget ledger ────────────────────────────────────────────────────────────
def _ledger_path():
    return os.path.join(STATE_DIR, "fp_budget.json")


def load_ledger():
    """{day, calls}. A new UTC day resets the count."""
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    try:
        with open(_ledger_path()) as f:
            led = json.load(f)
        if led.get("day") == today:
            return led
    except Exception:
        pass
    return {"day": today, "calls": 0}


def save_ledger(led):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = _ledger_path() + ".tmp"
    with open(tmp, "w") as f:
        json.dump(led, f)
    os.replace(tmp, _ledger_path())


LEDGER = load_ledger()


class BudgetExhausted(Exception):
    pass


def fp_get(path, **params):
    """One metered call. Raises BudgetExhausted rather than silently overspending."""
    if LEDGER["calls"] >= SOFT_CAP:
        raise BudgetExhausted(f"{LEDGER['calls']}/{DAILY_CAP} used today (soft cap {SOFT_CAP})")

    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{FP_BASE}{path}?{qs}"
    req = urllib.request.Request(url, headers={**UA, "x-api-key": API_KEY})

    last = None
    for attempt in range(3):
        try:
            LEDGER["calls"] += 1
            save_ledger(LEDGER)          # count before the attempt: a failed call still counts
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
            # 401/403 is a bad key and 429 is the cap — retrying either just
            # burns the budget faster.
            if e.code in (401, 403, 429):
                raise RuntimeError(f"FantasyPros {e.code} on {path}: {body}") from e
            last = f"{e.code} {body}"
        except Exception as e:
            last = str(e)
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"FantasyPros call failed after 3 tries: {path} ({last})")


# ── free, unmetered inputs ───────────────────────────────────────────────────
def fetch_raw(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def fetch_json(url):
    raw = fetch_raw(url)
    return json.loads(raw) if raw else None


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z ]", "", s.lower())
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def load_idmap():
    """fantasypros_id -> sleeper_id, from the DynastyProcess crosswalk.

    FantasyPros' own external_ids parameter offers yahoo/espn/cbs and a dozen
    others but not Sleeper, so the join has to come from somewhere. Cached to
    disk because it is a 5MB CSV that changes about weekly.
    """
    cache = os.path.join(STATE_DIR, "db_playerids.csv")
    raw = None
    try:
        age = time.time() - os.path.getmtime(cache)
        if age < 24 * 3600:
            with open(cache, encoding="utf-8") as f:
                raw = f.read()
    except Exception:
        pass
    if raw is None:
        raw = fetch_raw(IDMAP_URL)
        if raw:
            os.makedirs(STATE_DIR, exist_ok=True)
            with open(cache, "w", encoding="utf-8") as f:
                f.write(raw)
    if not raw:
        print("  ! no DynastyProcess crosswalk; falling back to name matching only", file=sys.stderr)
        return {}
    out = {}
    for row in csv.DictReader(io.StringIO(raw)):
        fp = (row.get("fantasypros_id") or "").strip()
        sl = (row.get("sleeper_id") or "").strip()
        if fp and sl:
            out[fp] = sl
    return out


def load_sleeper_players():
    """(name_idx, def_pids) for resolving FP players onto Sleeper pids."""
    raw = fetch_json(f"{SLEEPER}/players/nfl") or {}
    idx, defs = {}, set()
    for pid, p in raw.items():
        if not isinstance(p, dict):
            continue
        pos = p.get("position")
        if pos == "DEF":
            defs.add(pid)
            nm = norm(p.get("full_name") or p.get("team") or pid)
        else:
            nm = norm(f"{p.get('first_name','')} {p.get('last_name','')}")
        if nm:
            idx.setdefault((nm, pos), pid)
    return idx, defs


def league_scoring(league_id):
    lg = fetch_json(f"{SLEEPER}/league/{league_id}") or {}
    return lg.get("scoring_settings") or {}


# ── scoring ──────────────────────────────────────────────────────────────────
# FantasyPros stat field -> Sleeper scoring key. FP returns a stat line per
# player; Sleeper's scoring_settings is keyed by these names. Only the pairs
# that mean the same thing are listed — a guess here is worse than a gap,
# because a gap is reported and a guess is not.
STAT_MAP = {
    # passing
    "pass_yds": "pass_yd", "pass_yard": "pass_yd", "pass_yards": "pass_yd",
    "pass_tds": "pass_td", "pass_td": "pass_td",
    "pass_int": "pass_int", "pass_ints": "pass_int", "interceptions": "pass_int",
    "pass_att": "pass_att", "pass_cmp": "pass_cmp",
    # rushing
    "rush_yds": "rush_yd", "rush_yard": "rush_yd", "rush_yards": "rush_yd",
    "rush_tds": "rush_td", "rush_td": "rush_td", "rush_att": "rush_att",
    # receiving
    "rec": "rec", "receptions": "rec",
    "rec_yds": "rec_yd", "rec_yard": "rec_yd", "rec_yards": "rec_yd",
    "rec_tds": "rec_td", "rec_td": "rec_td",
    # turnovers
    "fum_lost": "fum_lost", "fumbles_lost": "fum_lost",
    # kicking
    "xpt": "xpm", "xpm": "xpm", "xp": "xpm",
    "fg": "fgm", "fgm": "fgm",
    # defense / special teams
    "sack": "sack", "sacks": "sack",
    "int": "int", "ints": "int",
    "fum_rec": "fum_rec", "fr": "fum_rec",
    "def_td": "def_td", "td": "def_td",
    "safety": "safe", "safeties": "safe",
}

# Scoring keys this league pays that nobody projects. Listed so coverage
# reporting can tell "FantasyPros did not send it" apart from "we forgot it".
UNPROJECTABLE = {
    "def_3_and_out", "def_4_and_stop", "tkl_loss", "fgm_yds_over_30",
    "fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49",
    "fgmiss_50_59", "fgmiss_50p", "fgmiss_60p", "xpmiss",
    "ff", "def_st_ff", "def_st_fum_rec", "def_st_td", "st_ff", "st_fum_rec", "st_td",
    "blk_kick", "pass_2pt", "rush_2pt", "rec_2pt", "pass_int_td",
}

# Positions whose league scoring depends mostly on things FantasyPros does not
# project. Their projections are still written, but flagged.
THIN_POSITIONS = {"K", "DEF"}


def stat_items(raw):
    """FP returns `stats` as either a dict or a list of {name,value} pairs."""
    if isinstance(raw, dict):
        return list(raw.items())
    if isinstance(raw, list):
        out = []
        for s in raw:
            if isinstance(s, dict):
                k = s.get("name") or s.get("stat") or s.get("key")
                v = s.get("value") if "value" in s else s.get("val")
                if k is not None:
                    out.append((k, v))
        return out
    return []


def num(v):
    try:
        return float(str(v).replace(",", ""))
    except Exception:
        return 0.0


def score_line(stats, scoring, unmapped):
    """Fantasy points for one projected stat line under the league's own rules."""
    pts = 0.0
    for name, value in stat_items(stats):
        key = STAT_MAP.get(str(name).strip().lower())
        if key is None:
            unmapped[str(name).strip().lower()] = unmapped.get(str(name).strip().lower(), 0) + 1
            continue
        rate = scoring.get(key)
        if rate:
            pts += num(value) * float(rate)
    return round(pts, 2)


# ── resolution ───────────────────────────────────────────────────────────────
def resolve(player, idmap, name_idx, def_pids):
    """FantasyPros player object -> Sleeper pid, or None."""
    fpid = str(player.get("fpid") or player.get("player_id") or "").strip()
    if fpid and fpid in idmap:
        return idmap[fpid]

    pos = player.get("position_id") or player.get("position")
    pos = "DEF" if pos in ("DST", "DEF") else pos
    if pos == "DEF":
        team = (player.get("team_id") or "").strip().upper()
        team = TEAM_ALIAS.get(team, team)
        return team if team in def_pids else None

    nm = norm(player.get("name") or player.get("player_name"))
    return name_idx.get((nm, pos))


def index_players(payload, idmap, name_idx, def_pids, build):
    """Map an FP response's players onto Sleeper pids via `build(player)`."""
    out, missed = {}, []
    for p in (payload.get("players") or []):
        pid = resolve(p, idmap, name_idx, def_pids)
        if not pid:
            missed.append(p.get("name") or p.get("player_name"))
            continue
        val = build(p)
        if val is not None:
            out[pid] = val
    return out, missed


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    if not API_KEY:
        print("FFPROS_API_KEY is not set — refusing to run.", file=sys.stderr)
        print("Expected it in the environment (see /boot/config/ffpros.env).", file=sys.stderr)
        return 2

    meta = {}
    try:
        with open(os.path.join(OUT_DIR, "meta.json")) as f:
            meta = json.load(f)
    except Exception:
        pass

    season = str(os.environ.get("SC_SEASON") or meta.get("nfl_season") or
                 datetime.date.today().year)
    week = int(os.environ.get("SC_WEEK") or meta.get("nfl_week") or 0)
    league_id = os.environ.get("SC_LEAGUE_ID") or meta.get("current_league_id")

    print(f"ffpros-api: season {season} week {week}  "
          f"budget {LEDGER['calls']}/{DAILY_CAP} used today")

    scoring = league_scoring(league_id) if league_id else {}
    if not scoring:
        print("  ! no league scoring_settings — cannot score raw stat lines", file=sys.stderr)
        return 3
    print(f"  league scoring: {len(scoring)} keys")

    idmap = load_idmap()
    name_idx, def_pids = load_sleeper_players()
    print(f"  crosswalk {len(idmap)} ids · sleeper index {len(name_idx)} names")

    unmapped = {}
    out = {
        "generated": datetime.datetime.now(datetime.timezone.utc)
                     .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "fantasypros-api-v2",
        "season": season,
        "week": week,
        "scoring": "league scoring_settings applied to FantasyPros stat lines",
        "low_confidence": sorted(THIN_POSITIONS),
    }

    def proj_entry(p):
        pos = p.get("position_id") or p.get("position")
        pos = "DEF" if pos == "DST" else pos
        return {"pts": score_line(p.get("stats"), scoring, unmapped), "pos": pos}

    def ecr_entry(p):
        return {
            "ecr": p.get("rank_ecr"),
            "pos_rank": p.get("pos_rank") or p.get("rank_ecr_pos"),
            "tier": p.get("tier"),
            "best": p.get("rank_min"), "worst": p.get("rank_max"),
            "stdev": p.get("rank_std"),
        }

    mode = "live" if "--mode=live" in sys.argv or "live" in sys.argv[1:] else "full"

    # A live refresh updates only the weekly halves, so the rest-of-season data
    # from the last full run has to survive. Load it before writing anything.
    prev = {}
    try:
        with open(os.path.join(OUT_DIR, "fp.json")) as f:
            prev = json.load(f)
    except Exception:
        if mode == "live":
            print("  no existing cache to merge onto — promoting to a full refresh")
            mode = "full"

    print(f"  mode: {mode}")
    calls = []
    try:
        # Weekly projections. week=0 is preseason, which is what we want before
        # the season starts, so the same call works year round.
        wp = fp_get(f"/nfl/{season}/projections", position="ALL", week=week)
        out["week_proj"], miss_wp = index_players(wp, idmap, name_idx, def_pids, proj_entry)
        calls.append(("projections week", len(out["week_proj"]), len(miss_wp)))

        we = fp_get(f"/nfl/{season}/consensus-rankings",
                    position="ALL", type="WW", week=week, scoring="PPR")
        out["ecr_week"], miss_we = index_players(we, idmap, name_idx, def_pids, ecr_entry)
        calls.append(("ecr week", len(out["ecr_week"]), len(miss_we)))

        if mode == "full":
            rp = fp_get(f"/nfl/{season}/projections", position="ALL", ros="true")
            out["ros_proj"], miss_rp = index_players(rp, idmap, name_idx, def_pids, proj_entry)
            calls.append(("projections ros", len(out["ros_proj"]), len(miss_rp)))

            re_ = fp_get(f"/nfl/{season}/consensus-rankings",
                         position="ALL", type="ROS", scoring="PPR")
            out["ecr_ros"], miss_re = index_players(re_, idmap, name_idx, def_pids, ecr_entry)
            calls.append(("ecr ros", len(out["ecr_ros"]), len(miss_re)))
            out["ros_generated"] = out["generated"]
        else:
            out["ros_proj"] = prev.get("ros_proj") or {}
            out["ros_ecr_stale"] = True
            out["ecr_ros"] = prev.get("ecr_ros") or {}
            # Carried, not refetched — consumers need to know how old it is.
            out["ros_generated"] = prev.get("ros_generated") or prev.get("generated")

    except BudgetExhausted as e:
        print(f"  ! budget exhausted: {e} — keeping the previous cache", file=sys.stderr)
        return 4
    except RuntimeError as e:
        print(f"  ! {e} — keeping the previous cache", file=sys.stderr)
        return 5

    for label, got, missed in calls:
        print(f"  {label:<18} {got:>4} resolved, {missed:>3} unmatched")

    if unmapped:
        top = sorted(unmapped.items(), key=lambda kv: -kv[1])[:12]
        print("  unmapped FP stat fields (not scored): " +
              ", ".join(f"{k}x{v}" for k, v in top))
        out["unmapped_stats"] = dict(top)

    out["calls_used_today"] = LEDGER["calls"]
    out["daily_cap"] = DAILY_CAP

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "fp.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, path)
    print(f"  wrote {path}  ({os.path.getsize(path)} bytes)  "
          f"budget now {LEDGER['calls']}/{DAILY_CAP}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
