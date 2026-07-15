#!/usr/bin/env python3
"""
Sleeper league data builder.
Walks the full previous_league_id history chain from a known current league,
resolves players/owners server-side, computes standings, all-play/luck, power
rankings, records, head-to-head, playoff bracket, transactions, draft recap and
the footspencerball team dashboard, then writes display-ready JSON into
/mnt/cache/appdata/www-data/sleeper/data/.

Run from cron. The public site only ever reads the small JSON outputs, never the
14MB players DB or the Sleeper API directly.
"""
import json
import os
import sys
import time
import hashlib
import colorsys
import urllib.request
import urllib.error
from datetime import datetime, timezone

# -- Config -------------------------------------------------------------------
# ANCHOR is any known league in our family. The current league is resolved
# dynamically each run (so new seasons are picked up automatically) by finding
# the most recent season league for TARGET_USERNAME whose previous_league_id
# chain leads back to this anchor.
ANCHOR_LEAGUE_ID  = "1227310846225428480"
TARGET_USERNAME   = "footspencerball"
OUT_DIR           = os.environ.get("SC_OUT_DIR", "/mnt/cache/appdata/www-data/sleeper/data")
API               = "https://api.sleeper.app/v1"
AVATAR_THUMB      = "https://sleepercdn.com/avatars/thumbs/"
MAX_WEEKS         = 18
MAX_SEASONS       = 12  # safety cap when walking the chain

# Championships won in seasons that predate our Sleeper data (no bracket to
# derive them from). owner_id -> extra title count. Recorded manually.
MANUAL_TITLES = {
    "1028010692307226624": 1,  # ComeComeInc (cullllen) - champion of a pre-data season
}

# Fast mode (set by the 5-min in-game gate): reuse cached data for immutable
# completed prior seasons so only the live current season is re-fetched.
FAST      = os.environ.get("SC_FAST") == "1"
CACHE_DIR = os.environ.get("SC_CACHE_DIR", "/mnt/cache/appdata/sleeper-cache")

# -- HTTP ---------------------------------------------------------------------
def fetch(url, tries=3, backoff=1.5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "scbeelink-sleeper/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:
            last = e
        time.sleep(backoff * (i + 1))
    print(f"  ! failed: {url} ({last})", file=sys.stderr)
    return None

# -- Globals resolved once ----------------------------------------------------
PLAYERS  = {}   # pid -> {name, pos, team, injury, age, exp, num}
STATS    = {}   # season -> {pid -> pts_ppr}
STATS_GP = {}   # season -> {pid -> games_played}

def load_players():
    global PLAYERS
    raw = fetch(f"{API}/players/nfl")
    if not raw:
        print("  ! could not load players DB", file=sys.stderr)
        return
    for pid, p in raw.items():
        if not isinstance(p, dict):
            continue
        pos = p.get("position") or (p.get("fantasy_positions") or [None])[0]
        injury = (p.get("injury_status") or "").strip()  # Out / Questionable / IR / Doubtful
        common = {"injury": injury, "age": p.get("age"), "exp": p.get("years_exp"),
                  "num": p.get("number")}
        if p.get("position") == "DEF" or (pid.isalpha() and pid.isupper() and len(pid) <= 3):
            name = p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip() or pid
            PLAYERS[pid] = {"name": name + " D/ST", "pos": "DEF", "team": p.get("team") or pid, **common}
        else:
            name = f"{p.get('first_name','')} {p.get('last_name','')}".strip() or pid
            PLAYERS[pid] = {"name": name, "pos": pos or "?", "team": p.get("team") or "FA", **common}

def load_stats(season):
    if season in STATS:
        return STATS[season]
    raw = fetch(f"{API}/stats/nfl/regular/{season}") or {}
    table, gp = {}, {}
    for pid, s in raw.items():
        if not isinstance(s, dict):
            continue
        pts = s.get("pts_ppr")
        if pts is None:
            continue
        if pid.startswith("TEAM_"):
            continue  # team OFFENSE totals, not DST fantasy points — would corrupt value calc
        table[pid] = round(pts, 2)
        gp[pid] = s.get("gp") or s.get("gms_active") or 0
    STATS[season] = table
    STATS_GP[season] = gp
    return table

# -- Lineup slot rules (the league's weekly starting requirements) -----------
FLEX_MAP = {
    "FLEX":       {"RB", "WR", "TE"},
    "WRRB_FLEX":  {"RB", "WR"},
    "REC_FLEX":   {"WR", "TE"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
    "IDP_FLEX":   {"DL", "LB", "DB"},
}
SLOT_LABEL = {"WRRB_FLEX": "W/R", "REC_FLEX": "W/T", "SUPER_FLEX": "SFLX"}

def starting_slots(league):
    return [p for p in (league.get("roster_positions") or [])
            if p not in ("BN", "IR", "TAXI")]

def optimal_lineup(players, slots):
    """Pick the highest-value legal lineup. players: [{pid,pos,value,...}].
    Fixed-position slots are filled first, then flex slots take the best leftover
    — which is optimal for this slot structure. Returns (picks_by_slot, total)."""
    pool = sorted([p for p in players if p.get("value") is not None], key=lambda p: -p["value"])
    used = set()
    picks = [None] * len(slots)
    for i, slot in enumerate(slots):
        if slot in FLEX_MAP:
            continue
        for p in pool:
            if p["pid"] in used:
                continue
            if p["pos"] == slot:
                picks[i] = p; used.add(p["pid"]); break
    for i, slot in enumerate(slots):
        if slot not in FLEX_MAP:
            continue
        elig = FLEX_MAP[slot]
        for p in pool:
            if p["pid"] in used:
                continue
            if p["pos"] in elig:
                picks[i] = p; used.add(p["pid"]); break
    total = round(sum(p["value"] for p in picks if p), 2)
    return picks, total

def team_color(owner_id):
    """Deterministic, readable-on-dark accent color per manager."""
    h = int(hashlib.md5(str(owner_id).encode()).hexdigest()[:8], 16)
    hue = (h % 360) / 360.0
    r, g, b = colorsys.hls_to_rgb(hue, 0.62, 0.55)
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))

PROJ = {}        # pid -> projected pts_ppr for the active target week
PROJ_META = {}   # {season, week, available}
def load_projections(season, week):
    """Upcoming-week PPR projections via the public projections feed."""
    url = f"https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular"
    data = fetch(url) or []
    table = {}
    if isinstance(data, list):
        for it in data:
            pid = str(it.get("player_id"))
            pts = (it.get("stats") or {}).get("pts_ppr")
            if pts:
                table[pid] = round(pts, 2)
    return table

# Raw box-score stat lines kept for player game logs (Sleeper omits zero stats).
STAT_KEYS = ("pass_cmp", "pass_att", "pass_yd", "pass_td", "pass_int",
             "rush_att", "rush_yd", "rush_td",
             "rec", "rec_tgt", "rec_yd", "rec_td",
             "fgm", "fga", "xpm",
             "def_sack", "sack", "def_int", "def_td", "def_ff", "def_fr", "pts_allow")

WEEKLY = {}   # (season, week) -> {pid: {"ppr":x,"half":y,"std":z,"raw":{...}}}
def load_weekly(season, week):
    key = (season, week)
    if key in WEEKLY:
        return WEEKLY[key]
    raw = fetch(f"{API}/stats/nfl/regular/{season}/{week}") or {}
    table = {}
    for pid, s in raw.items():
        if not isinstance(s, dict) or pid.startswith("TEAM_"):
            continue
        table[pid] = {
            "ppr":  s.get("pts_ppr", 0.0) or 0.0,
            "half": s.get("pts_half_ppr", 0.0) or 0.0,
            "std":  s.get("pts_std", 0.0) or 0.0,
            "raw":  {k: round(s[k], 1) for k in STAT_KEYS if s.get(k)},
        }
    WEEKLY[key] = table
    return table

# NFL bye weeks per team per season (a team's bye = the week it has no game).
BYES = {}
def load_team_byes(season):
    if season in BYES:
        return BYES[season]
    sched = fetch(f"https://api.sleeper.app/schedule/nfl/regular/{season}") or []
    played = {}
    for g in (sched or []):
        w = g.get("week")
        for t in (g.get("home"), g.get("away")):
            if t:
                played.setdefault(t, set()).add(w)
    byes = {}
    for t, weeks in played.items():
        for w in range(1, 19):
            if w not in weeks:
                byes[t] = w
                break
    BYES[season] = byes
    return byes

def pname(pid):
    p = PLAYERS.get(str(pid))
    return p["name"] if p else f"#{pid}"

def pmeta(pid):
    return PLAYERS.get(str(pid), {"name": f"#{pid}", "pos": "?", "team": "FA"})

# -- Identity helpers ---------------------------------------------------------
def owner_obj(users, user_id):
    for u in users:
        if u.get("user_id") == user_id:
            return u
    return None

def nick_map(rosters):
    """owner_id -> {pid: nickname}. Managers set per-player nicknames in Sleeper;
    they live in each roster's metadata as p_nick_<player_id>."""
    out = {}
    for r in rosters or []:
        md = r.get("metadata") or {}
        nd = {k[7:]: v for k, v in md.items() if k.startswith("p_nick_") and v}
        if nd:
            out[r.get("owner_id")] = nd
    return out


def team_name(roster, users):
    md = roster.get("metadata") or {}
    if md.get("team_name"):
        return md["team_name"]
    o = owner_obj(users, roster.get("owner_id"))
    if o:
        omd = o.get("metadata") or {}
        if omd.get("team_name"):
            return omd["team_name"]
        return o.get("display_name") or o.get("username") or f"Team {roster.get('roster_id')}"
    return f"Team {roster.get('roster_id')}"

def owner_name(users, user_id):
    o = owner_obj(users, user_id)
    if not o:
        return "Unknown"
    return o.get("display_name") or o.get("username") or "Unknown"

def avatar_url(users, user_id):
    o = owner_obj(users, user_id)
    if not o:
        return None
    # Prefer the league team's custom avatar (metadata.avatar = a full URL) over
    # the Sleeper account profile pic.
    md = o.get("metadata") or {}
    if md.get("avatar"):
        return md["avatar"]
    if o.get("avatar"):
        return AVATAR_THUMB + o["avatar"]
    return None

# -- Per-season fetch ---------------------------------------------------------
def _cache_path(lid):
    return os.path.join(CACHE_DIR, f"{lid}.json")

def gather_season(league_id):
    # Fast (in-game) builds: reuse cached immutable completed seasons.
    if FAST:
        try:
            c = json.load(open(_cache_path(league_id)))
            if (c.get("league") or {}).get("status") == "complete":
                c["matchups"] = {int(k): v for k, v in c.get("matchups", {}).items()}
                c["transactions_by_week"] = {int(k): v for k, v in c.get("transactions_by_week", {}).items()}
                return c
        except Exception:
            pass

    league = fetch(f"{API}/league/{league_id}")
    if not league:
        return None
    season = league.get("season")
    rosters = fetch(f"{API}/league/{league_id}/rosters") or []
    users   = fetch(f"{API}/league/{league_id}/users") or []
    settings = league.get("settings", {}) or {}
    playoff_start = settings.get("playoff_week_start") or 15

    matchups = {}
    for w in range(1, MAX_WEEKS + 1):
        data = fetch(f"{API}/league/{league_id}/matchups/{w}")
        if data:
            matchups[w] = data

    transactions = []
    transactions_by_week = {}
    for w in range(0, MAX_WEEKS + 1):
        data = fetch(f"{API}/league/{league_id}/transactions/{w}")
        if data:
            transactions.extend(data)
            transactions_by_week[w] = data

    winners = fetch(f"{API}/league/{league_id}/winners_bracket") or []
    losers  = fetch(f"{API}/league/{league_id}/losers_bracket") or []
    drafts  = fetch(f"{API}/league/{league_id}/drafts") or []

    result = {
        "league": league, "season": season, "rosters": rosters, "users": users,
        "matchups": matchups, "transactions": transactions,
        "transactions_by_week": transactions_by_week, "playoff_start": playoff_start,
        "winners": winners, "losers": losers, "drafts": drafts, "league_id": league_id,
    }
    # Cache completed (immutable) seasons so fast in-game builds skip re-fetching them.
    if league.get("status") == "complete":
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            tmp = _cache_path(league_id) + ".tmp"
            with open(tmp, "w") as f:
                json.dump({k: v for k, v in result.items()}, f)
            os.replace(tmp, _cache_path(league_id))
        except Exception:
            pass
    return result

# -- Derived: weekly games + all-play ----------------------------------------
def compute_games(season_data):
    """Return list of per-team game dicts for the regular season."""
    rosters = season_data["rosters"]
    users   = season_data["users"]
    matchups = season_data["matchups"]
    playoff_start = season_data["playoff_start"]
    rid_name = {r["roster_id"]: team_name(r, users) for r in rosters}
    rid_owner = {r["roster_id"]: r.get("owner_id") for r in rosters}

    games = []   # {week, roster_id, owner, opp_roster, opp_owner, pts, opp_pts, result}
    allplay = {r["roster_id"]: {"w": 0, "l": 0, "t": 0} for r in rosters}

    for w, ms in matchups.items():
        if w >= playoff_start:
            continue
        # Skip weeks not yet played (mid-season): nobody has scored
        if not any((m.get("points") or 0) > 0 for m in ms):
            continue
        # All-play: rank all teams that scored this week (exclude unplayed/zero)
        scored = [(m["roster_id"], m.get("points") or 0.0) for m in ms
                  if m.get("points") is not None and (m.get("points") or 0) > 0]
        for rid, pts in scored:
            for orid, opts in scored:
                if rid == orid:
                    continue
                if pts > opts:   allplay[rid]["w"] += 1
                elif pts < opts: allplay[rid]["l"] += 1
                else:            allplay[rid]["t"] += 1
        # Head-to-head game results
        by_mid = {}
        for m in ms:
            by_mid.setdefault(m.get("matchup_id"), []).append(m)
        for mid, pair in by_mid.items():
            if mid is None or len(pair) != 2:
                continue
            a, b = pair
            ap, bp = a.get("points") or 0.0, b.get("points") or 0.0
            if ap <= 0 and bp <= 0:   # matchup not played yet
                continue
            for me, opp in ((a, b), (b, a)):
                mp, op = me.get("points") or 0.0, opp.get("points") or 0.0
                res = "W" if mp > op else "L" if mp < op else "T"
                games.append({
                    "season": season_data["season"], "week": w,
                    "roster_id": me["roster_id"], "owner": rid_owner.get(me["roster_id"]),
                    "team": rid_name.get(me["roster_id"]),
                    "opp_roster": opp["roster_id"], "opp_owner": rid_owner.get(opp["roster_id"]),
                    "opp_team": rid_name.get(opp["roster_id"]),
                    "pts": round(mp, 2), "opp_pts": round(op, 2), "result": res,
                })
    return games, allplay, rid_name, rid_owner

# -- Standings ----------------------------------------------------------------
def build_standings(season_data, games, allplay, rid_name):
    rosters = season_data["rosters"]
    users   = season_data["users"]
    rows = []
    for r in rosters:
        rid = r["roster_id"]
        s = r.get("settings", {}) or {}
        wins = s.get("wins", 0); losses = s.get("losses", 0); ties = s.get("ties", 0)
        pf = float(s.get("fpts", 0)) + float(s.get("fpts_decimal", 0)) / 100.0
        pa = float(s.get("fpts_against", 0)) + float(s.get("fpts_against_decimal", 0)) / 100.0
        ap = allplay.get(rid, {"w": 0, "l": 0, "t": 0})
        ap_total = ap["w"] + ap["l"] + ap["t"]
        ap_pct = ap["w"] / ap_total if ap_total else 0.0
        gp = wins + losses + ties
        exp_w = ap_pct * gp
        luck = round(wins - exp_w, 1)
        # streak from games in week order
        my = sorted([g for g in games if g["roster_id"] == rid], key=lambda g: g["week"])
        streak = ""
        if my:
            last = my[-1]["result"]; n = 0
            for g in reversed(my):
                if g["result"] == last: n += 1
                else: break
            streak = f"{last}{n}"
        rows.append({
            "roster_id": rid, "team": rid_name.get(rid), "owner": owner_name(users, r.get("owner_id")),
            "owner_id": r.get("owner_id"),
            "avatar": avatar_url(users, r.get("owner_id")), "season": season_data["season"],
            "wins": wins, "losses": losses, "ties": ties,
            "pf": round(pf, 2), "pa": round(pa, 2),
            "all_play": f"{ap['w']}-{ap['l']}" + (f"-{ap['t']}" if ap['t'] else ""),
            "all_play_pct": round(ap_pct, 3), "luck": luck, "streak": streak,
        })
    rows.sort(key=lambda x: (-x["wins"], -x["pf"]))
    for i, row in enumerate(rows, 1):
        row["rank"] = i
    return rows

# -- Power rankings -----------------------------------------------------------
def build_power(standings):
    pr = sorted(standings, key=lambda x: (-x["all_play_pct"], -x["pf"]))
    out = []
    for i, s in enumerate(pr, 1):
        out.append({
            "rank": i, "team": s["team"], "owner": s["owner"], "avatar": s["avatar"],
            "all_play_pct": s["all_play_pct"], "all_play": s["all_play"],
            "pf": s["pf"], "record": f"{s['wins']}-{s['losses']}" + (f"-{s['ties']}" if s["ties"] else ""),
            "seed_rank": s["rank"],
        })
    return out

# -- Records / superlatives ---------------------------------------------------
def build_records(all_games, standings):
    # all_games are per-team game rows (each matchup appears twice)
    if not all_games:
        return {}
    hi = max(all_games, key=lambda g: g["pts"])
    lo = min(all_games, key=lambda g: g["pts"])
    blow = max(all_games, key=lambda g: g["pts"] - g["opp_pts"])
    # closest: among decided games
    decided = [g for g in all_games if g["result"] != "T"]
    close = min(decided, key=lambda g: abs(g["pts"] - g["opp_pts"])) if decided else None
    # combined highest matchup
    combo = max(all_games, key=lambda g: g["pts"] + g["opp_pts"])
    luckiest = max(standings, key=lambda s: s["luck"])
    unluckiest = min(standings, key=lambda s: s["luck"])
    most_pf = max(standings, key=lambda s: s["pf"])
    fewest_pf = min(standings, key=lambda s: s["pf"])
    # longest win streak across season
    best_streak = {"team": None, "len": 0}
    by_team = {}
    for g in all_games:
        by_team.setdefault((g["season"], g["roster_id"]), []).append(g)
    for key, gs in by_team.items():
        gs.sort(key=lambda g: g["week"])
        cur = 0; team = gs[0]["team"]
        for g in gs:
            cur = cur + 1 if g["result"] == "W" else 0
            if cur > best_streak["len"]:
                best_streak = {"team": team, "len": cur, "season": g["season"]}
    return {
        "highest_score": {"team": hi["team"], "pts": hi["pts"], "week": hi["week"], "season": hi["season"], "opp": hi["opp_team"]},
        "lowest_score": {"team": lo["team"], "pts": lo["pts"], "week": lo["week"], "season": lo["season"], "opp": lo["opp_team"]},
        "biggest_blowout": {"team": blow["team"], "opp": blow["opp_team"], "pts": blow["pts"], "opp_pts": blow["opp_pts"], "margin": round(blow["pts"] - blow["opp_pts"], 2), "week": blow["week"], "season": blow["season"]},
        "closest_game": ({"team": close["team"], "opp": close["opp_team"], "pts": close["pts"], "opp_pts": close["opp_pts"], "margin": round(abs(close["pts"] - close["opp_pts"]), 2), "week": close["week"], "season": close["season"]} if close else None),
        "highest_matchup": {"team": combo["team"], "opp": combo["opp_team"], "total": round(combo["pts"] + combo["opp_pts"], 2), "week": combo["week"], "season": combo["season"]},
        "luckiest": {"team": luckiest["team"], "luck": luckiest["luck"], "season": luckiest.get("season")},
        "unluckiest": {"team": unluckiest["team"], "luck": unluckiest["luck"], "season": unluckiest.get("season")},
        "most_pf": {"team": most_pf["team"], "pf": most_pf["pf"], "season": most_pf.get("season")},
        "fewest_pf": {"team": fewest_pf["team"], "pf": fewest_pf["pf"], "season": fewest_pf.get("season")},
        "longest_streak": best_streak,
    }

# -- Head to head (by owner, all-time) ---------------------------------------
def build_h2h(all_games, owner_disp):
    owners = sorted(owner_disp.keys(), key=lambda o: owner_disp[o])
    matrix = {o: {o2: {"w": 0, "l": 0, "t": 0} for o2 in owners} for o in owners}
    for g in all_games:
        a, b = g["owner"], g["opp_owner"]
        if a not in matrix or b not in matrix[a]:
            continue
        if g["result"] == "W": matrix[a][b]["w"] += 1
        elif g["result"] == "L": matrix[a][b]["l"] += 1
        else: matrix[a][b]["t"] += 1
    return {
        "owners": [{"id": o, "name": owner_disp[o]} for o in owners],
        "matrix": matrix,
    }

# -- Bracket ------------------------------------------------------------------
def build_bracket(bracket, rid_name):
    out = []
    for e in bracket:
        out.append({
            "round": e.get("r"), "match": e.get("m"),
            "t1": rid_name.get(e.get("t1")) if isinstance(e.get("t1"), int) else None,
            "t2": rid_name.get(e.get("t2")) if isinstance(e.get("t2"), int) else None,
            "t1_from": e.get("t1_from"), "t2_from": e.get("t2_from"),
            "winner": rid_name.get(e.get("w")) if e.get("w") else None,
            "loser": rid_name.get(e.get("l")) if e.get("l") else None,
            "place": e.get("p"),
        })
    return out

# -- Transactions feed --------------------------------------------------------
def build_transactions(season_data, rid_name):
    feed = []
    for t in season_data["transactions"]:
        if t.get("status") != "complete":
            continue
        ttype = t.get("type")
        created = t.get("created")
        adds = t.get("adds") or {}
        drops = t.get("drops") or {}
        rosters_involved = t.get("roster_ids") or []
        if ttype == "trade":
            sides = {}
            for pid, rid in adds.items():
                sides.setdefault(rid, {"in": [], "out": []})["in"].append(pmeta(pid)["name"])
            for pid, rid in drops.items():
                sides.setdefault(rid, {"in": [], "out": []})["out"].append(pmeta(pid)["name"])
            for dp in (t.get("draft_picks") or []):
                owner_r = dp.get("owner_id");
                sides.setdefault(owner_r, {"in": [], "out": []})["in"].append(f"{dp.get('season')} R{dp.get('round')} pick")
            parts = []
            for rid, mv in sides.items():
                got = ", ".join(mv["in"]) or "—"
                parts.append(f"{rid_name.get(rid, 'Team')} got {got}")
            feed.append({"type": "trade", "created": created, "teams": [rid_name.get(r) for r in rosters_involved], "summary": "  |  ".join(parts)})
        else:
            for pid, rid in adds.items():
                drop_name = None
                for dpid, drid in drops.items():
                    if drid == rid:
                        drop_name = pmeta(dpid)["name"]; break
                m = pmeta(pid)
                feed.append({
                    "type": ttype, "created": created, "team": rid_name.get(rid),
                    "add": m["name"], "add_pos": m["pos"], "add_team": m["team"],
                    "drop": drop_name,
                })
    feed.sort(key=lambda x: x.get("created") or 0, reverse=True)
    return feed

# -- Draft recap --------------------------------------------------------------
def build_draft(season_data):
    drafts = season_data["drafts"]
    if not drafts:
        return None
    draft = sorted(drafts, key=lambda d: d.get("start_time") or 0, reverse=True)[0]
    did = draft["draft_id"]
    picks = fetch(f"{API}/draft/{did}/picks") or []
    season = draft.get("season")
    stats = load_stats(season)
    rosters = season_data["rosters"]
    users = season_data["users"]
    rid_name = {r["roster_id"]: team_name(r, users) for r in rosters}

    rows = []
    for p in picks:
        pid = p.get("player_id")
        meta = pmeta(pid)
        rid = p.get("roster_id")
        pts = stats.get(str(pid), 0.0)
        rows.append({
            "round": p.get("round"), "pick": p.get("pick_no"),
            "draft_slot": p.get("draft_slot"),
            "team": rid_name.get(rid, "—"), "roster_id": rid, "pid": str(pid),
            "player": meta["name"], "pos": meta["pos"], "nfl_team": meta["team"],
            "pts_ppr": pts,
        })
    rows.sort(key=lambda r: r["pick"] or 0)

    # Hindsight value: rank drafted SKILL players by season pts vs draft slot.
    # DEF/K excluded — their scoring isn't comparable in this stats feed.
    SKILL = {"QB", "RB", "WR", "TE"}
    ranked = sorted([r for r in rows if r["pos"] in SKILL and r["pts_ppr"]], key=lambda r: -r["pts_ppr"])
    for i, r in enumerate(ranked, 1):
        r["value_rank"] = i
        r["value"] = r["pick"] - i if r["pick"] else 0  # positive = steal
    by_pos = {}
    for r in ranked:
        by_pos[r["pos"]] = by_pos.get(r["pos"], 0) + 1
        r["pos_finish"] = f"{r['pos']}{by_pos[r['pos']]}"
    for r in rows:
        r.setdefault("value", 0)

    valued = [r for r in rows if "value_rank" in r]
    steals = sorted(valued, key=lambda r: -r["value"])[:8]
    busts = sorted([r for r in valued if r["pick"] and r["pick"] <= 72], key=lambda r: r["value"])[:8]

    rounds = max((r["round"] or 0 for r in rows), default=0)
    by_round = [[r for r in rows if r["round"] == rd] for rd in range(1, rounds + 1)]

    # team draft totals
    team_tot = {}
    for r in rows:
        team_tot.setdefault(r["team"], {"team": r["team"], "total": 0.0, "picks": 0})
        team_tot[r["team"]]["total"] += r["pts_ppr"] or 0
        team_tot[r["team"]]["picks"] += 1
    team_grades = sorted(team_tot.values(), key=lambda x: -x["total"])
    for t in team_grades:
        t["total"] = round(t["total"], 1)
        t["avg"] = round(t["total"] / t["picks"], 1) if t["picks"] else 0

    return {
        "meta": {"draft_id": did, "season": season, "type": draft.get("type"),
                 "rounds": rounds, "teams": draft.get("settings", {}).get("teams"),
                 "start_time": draft.get("start_time")},
        "picks": rows, "by_round": by_round,
        "steals": steals, "busts": busts,
        "team_grades": team_grades,
    }

# -- Per-season draft picks by roster ----------------------------------------
def season_draft_by_roster(sd):
    """Return {roster_id: [pick dicts]} for the season's draft (cached on sd)."""
    if "_draft_by_roster" in sd:
        return sd["_draft_by_roster"]
    out = {}
    drafts = sd.get("drafts") or []
    if drafts:
        draft = sorted(drafts, key=lambda d: d.get("start_time") or 0, reverse=True)[0]
        picks = fetch(f"{API}/draft/{draft['draft_id']}/picks") or []
        stats = load_stats(sd["season"])
        for p in picks:
            pid = str(p.get("player_id"))
            m = pmeta(pid)
            out.setdefault(p.get("roster_id"), []).append({
                "round": p.get("round"), "pick": p.get("pick_no"), "pid": pid,
                "player": m["name"], "pos": m["pos"], "pts_ppr": stats.get(pid, 0.0),
            })
    sd["_draft_by_roster"] = out
    return out

# -- Per-team dashboard (any owner, all seasons) -----------------------------
def build_team_full(chain, owner_id, all_games):
    """Full per-owner payload: identity, all-time totals, and per-season detail
    including the end-of-season roster (with player ids for headshots)."""
    seasons_out = []
    latest_name = None; latest_avatar = None; owner_label = None
    at = {"w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0, "championships": 0,
          "best_finish": 99, "seasons": 0, "playoff_apps": 0, "high": None, "low": None}

    for sd in chain:
        roster = next((r for r in sd["rosters"] if r.get("owner_id") == owner_id), None)
        if not roster:
            continue
        users = sd["users"]; season = sd["season"]
        rid = roster["roster_id"]
        stats = load_stats(season)
        tname = team_name(roster, users)
        if latest_name is None:
            latest_name = tname; latest_avatar = avatar_url(users, owner_id); owner_label = owner_name(users, owner_id)

        positions = [p for p in sd["league"].get("roster_positions", []) if p != "BN"]
        starters = roster.get("starters", []) or []
        starter_set = set(starters)
        nd = nick_map(sd["rosters"]).get(owner_id, {})

        def prow(pid, slot=None):
            m = pmeta(pid)
            return {"pid": str(pid), "player": m["name"], "nick": nd.get(str(pid)) or "", "pos": m["pos"],
                    "nfl_team": m["team"], "pts_ppr": stats.get(str(pid), 0.0), "slot": slot,
                    "injury": m.get("injury") or "", "age": m.get("age"), "exp": m.get("exp")}

        roster_rows = []
        for i, pid in enumerate(starters):
            roster_rows.append(prow(pid, positions[i] if i < len(positions) else "FLEX"))
        bench = [prow(pid, "BN") for pid in roster.get("players", []) if pid not in starter_set]
        bench.sort(key=lambda r: -(r["pts_ppr"] or 0))

        # ---- Weekly lineup efficiency (points left on the bench) -------------
        slots = starting_slots(sd["league"])
        opt_total = act_total = 0.0; eff_weeks = 0
        for w, ms in sd["matchups"].items():
            if w >= sd["playoff_start"]:
                continue
            me = next((m for m in ms if m["roster_id"] == rid), None)
            if not me:
                continue
            pp = me.get("players_points") or {}
            if not any((v or 0) > 0 for v in pp.values()):
                continue  # unplayed week
            plist = [{"pid": str(pid), "pos": pmeta(pid)["pos"], "value": pp.get(pid, 0.0)}
                     for pid in (me.get("players") or [])]
            _, opt = optimal_lineup(plist, slots)
            act = sum(pp.get(pid, 0.0) for pid in (me.get("starters") or []))
            opt_total += opt; act_total += act; eff_weeks += 1
        efficiency = {
            "optimal": round(opt_total, 1), "actual": round(act_total, 1),
            "left_on_bench": round(opt_total - act_total, 1),
            "pct": round(act_total / opt_total * 100, 1) if opt_total else None,
            "weeks": eff_weeks,
        }

        # ---- Recommended lineup from the current roster ---------------------
        # Prefer the upcoming week's projections; fall back to last season's PPG
        # (e.g. in the offseason before projections are published).
        recommended = None
        if sd is chain[0]:
            gpmap = STATS_GP.get(season, {})
            use_proj = bool(PROJ) and PROJ_META.get("available")
            pool = []
            for pid in (roster.get("players") or []):
                pid = str(pid)
                mm = pmeta(pid)
                ppr = stats.get(pid, 0.0); g = gpmap.get(pid, 0) or 0
                ppg = round(ppr / g, 2) if g else 0.0
                proj = PROJ.get(pid, 0.0)
                value = proj if use_proj else ppg
                pool.append({"pid": pid, "player": mm["name"], "pos": mm["pos"], "nfl_team": mm["team"],
                             "value": value, "proj": proj, "ppg": ppg,
                             "injury": mm.get("injury") or "", "pts_ppr": ppr})
            picks, total = optimal_lineup(pool, slots)
            rec_rows = []
            for i, slot in enumerate(slots):
                p = picks[i]
                row = {"slot": slot}
                if p:
                    row.update({k: p[k] for k in ("pid", "player", "pos", "nfl_team", "proj", "ppg", "injury", "pts_ppr")})
                    row["value"] = p["value"]
                rec_rows.append(row)
            basis = (f"Week {PROJ_META.get('week')} projections" if use_proj
                     else f"{season} points/game (projections publish once the season starts)")
            recommended = {"lineup": rec_rows, "proj_total": round(total, 1),
                           "basis": basis, "uses_projections": use_proj}

        s = roster.get("settings", {}) or {}
        pf = round(float(s.get("fpts", 0)) + float(s.get("fpts_decimal", 0)) / 100.0, 2)
        pa = round(float(s.get("fpts_against", 0)) + float(s.get("fpts_against_decimal", 0)) / 100.0, 2)
        srow = next((x for x in sd["_standings"] if x["roster_id"] == rid), None)
        finish = srow["rank"] if srow else None

        my_games = sorted([g for g in all_games if g["season"] == season and g["roster_id"] == rid], key=lambda g: g["week"])
        game_log = [{"week": g["week"], "opp": g["opp_team"], "pts": g["pts"], "opp_pts": g["opp_pts"], "result": g["result"]} for g in my_games]
        scores = [g["pts"] for g in my_games]

        draft_picks = sorted(season_draft_by_roster(sd).get(rid, []), key=lambda p: p["pick"] or 0)

        tname_for_tx = tname
        season_tx = build_transactions(sd, {r["roster_id"]: team_name(r, users) for r in sd["rosters"]})
        my_tx = [t for t in season_tx if (t.get("team") == tname_for_tx) or (tname_for_tx in (t.get("teams") or []))]

        is_champ = any(e.get("p") == 1 and e.get("w") == rid for e in sd["winners"])
        made_playoffs = any((e.get("t1") == rid or e.get("t2") == rid) for e in sd["winners"])

        seasons_out.append({
            "season": season, "league_id": sd["league_id"], "team_name": tname,
            "finish": finish, "champion": is_champ,
            "record": f"{s.get('wins',0)}-{s.get('losses',0)}" + (f"-{s.get('ties')}" if s.get('ties') else ""),
            "wins": s.get("wins", 0), "losses": s.get("losses", 0), "ties": s.get("ties", 0),
            "pf": pf, "pa": pa,
            "all_play": srow["all_play"] if srow else "", "luck": srow["luck"] if srow else 0,
            "avg": round(sum(scores) / len(scores), 1) if scores else 0,
            "roster": roster_rows + bench,
            "game_log": game_log,
            "draft_picks": draft_picks,
            "transactions": my_tx,
            "efficiency": efficiency,
            "recommended": recommended,
        })

        at["seasons"] += 1
        at["w"] += s.get("wins", 0); at["l"] += s.get("losses", 0); at["t"] += s.get("ties", 0)
        at["pf"] += pf; at["pa"] += pa
        if is_champ: at["championships"] += 1
        if made_playoffs: at["playoff_apps"] += 1
        if finish: at["best_finish"] = min(at["best_finish"], finish)
        for g in my_games:
            if at["high"] is None or g["pts"] > at["high"]["pts"]:
                at["high"] = {"pts": g["pts"], "season": season, "week": g["week"], "opp": g["opp_team"]}
            if at["low"] is None or g["pts"] < at["low"]["pts"]:
                at["low"] = {"pts": g["pts"], "season": season, "week": g["week"], "opp": g["opp_team"]}

    # Fold in any manually-recorded titles from pre-data seasons.
    extra_titles = MANUAL_TITLES.get(owner_id, 0)
    if extra_titles:
        at["championships"] += extra_titles
        at["best_finish"] = 1  # a championship is a first-place finish

    if not seasons_out:
        return None
    gp = at["w"] + at["l"] + at["t"]
    at["pf"] = round(at["pf"], 1); at["pa"] = round(at["pa"], 1)
    at["win_pct"] = round(at["w"] / gp, 3) if gp else 0
    return {
        "meta": {"owner_id": owner_id, "team": latest_name, "owner": owner_label,
                 "avatar": latest_avatar, "color": team_color(owner_id)},
        "all_time": at,
        "seasons": seasons_out,
    }

# -- Teams index --------------------------------------------------------------
def build_teams_index(team_payloads):
    out = []
    for tp in team_payloads:
        at = tp["all_time"]
        latest = tp["seasons"][0] if tp["seasons"] else None
        out.append({
            "owner_id": tp["meta"]["owner_id"], "team": tp["meta"]["team"],
            "owner": tp["meta"]["owner"], "avatar": tp["meta"]["avatar"],
            "color": tp["meta"].get("color"),
            "record": f"{at['w']}-{at['l']}" + (f"-{at['t']}" if at['t'] else ""),
            "win_pct": at["win_pct"], "pf": at["pf"], "championships": at["championships"],
            "seasons": at["seasons"], "best_finish": at["best_finish"],
            "latest": ({"season": latest["season"], "team_name": latest["team_name"],
                        "finish": latest["finish"], "record": latest["record"]} if latest else None),
        })
    out.sort(key=lambda x: (-x["championships"], -x["win_pct"], -x["pf"]))
    return out

# -- What-if engine -----------------------------------------------------------
def median(vals):
    v = sorted(vals)
    n = len(v)
    if n == 0:
        return 0
    return (v[n//2] if n % 2 else (v[n//2 - 1] + v[n//2]) / 2)

def _rank_records(recs):
    rows = sorted(recs.values(), key=lambda x: (-x["w"], -x.get("pf", 0)))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
        gp = r["w"] + r["l"] + r["t"]
        r["record"] = f"{r['w']}-{r['l']}" + (f"-{r['t']}" if r["t"] else "")
    return rows

def build_whatif_season(sd, all_games):
    """Return alternate-reality standings for one season."""
    users = sd["users"]
    rid_name = {r["roster_id"]: team_name(r, users) for r in sd["rosters"]}
    playoff_start = sd["playoff_start"]
    slots = starting_slots(sd["league"])
    # only regular-season weeks that have actually been played (mid-season safe)
    reg_weeks = [w for w in sorted(sd["matchups"].keys())
                 if w < playoff_start and any((m.get("points") or 0) > 0 for m in sd["matchups"][w])]

    # base record skeleton
    def skel():
        return {rid: {"team": rid_name[rid], "w": 0, "l": 0, "t": 0, "pf": 0.0}
                for rid in rid_name}

    # ---- Alternate scoring: anchor the league's REAL recorded points, then vary
    # only the reception component. A player's receptions = pts_ppr - pts_std in
    # the weekly stats (exact, independent of any custom league scoring), so the
    # PPR column reproduces the league's actual scoring history to the point, and
    # half/standard remove 0.5 / 1.0 per reception. (Recomputing everything from
    # Sleeper's global pts_ppr drifts up to ~10 pts/team/week from reality.)
    scoring = {s: skel() for s in ("ppr", "half", "std")}
    have_weekly = True
    for w in reg_weeks:
        wk = load_weekly(sd["season"], w)
        if not wk:
            have_weekly = False
        ms = sd["matchups"][w]
        by_mid = {}
        for m in ms:
            if m.get("matchup_id") is None:
                continue
            by_mid.setdefault(m["matchup_id"], []).append(m)
        team_pts = {"ppr": {}, "half": {}, "std": {}}
        for m in ms:
            rid = m["roster_id"]
            actual = m.get("points") or 0
            rec_ct = 0.0
            for pid in (m.get("starters") or []):
                st = wk.get(str(pid)) if wk else None
                if st:
                    rec_ct += (st["ppr"] - st["std"])   # reception count for this player
            team_pts["ppr"][rid] = actual
            team_pts["half"][rid] = round(actual - 0.5 * rec_ct, 2)
            team_pts["std"][rid] = round(actual - 1.0 * rec_ct, 2)
        for scheme in ("ppr", "half", "std"):
            for mid, pair in by_mid.items():
                if len(pair) != 2:
                    continue
                a, b = pair
                ap = team_pts[scheme].get(a["roster_id"], 0)
                bp = team_pts[scheme].get(b["roster_id"], 0)
                for me, mp, op in ((a, ap, bp), (b, bp, ap)):
                    rec = scoring[scheme][me["roster_id"]]
                    rec["pf"] += mp
                    if mp > op: rec["w"] += 1
                    elif mp < op: rec["l"] += 1
                    else: rec["t"] += 1
    for scheme in scoring:
        for rec in scoring[scheme].values():
            rec["pf"] = round(rec["pf"], 1)

    # ---- Median wins (each week, beat the median = bonus win) ----------------
    median_rec = skel()
    # seed with actual H2H
    for g in all_games:
        if g["season"] != sd["season"] or g["week"] >= playoff_start:
            continue
        rec = median_rec[g["roster_id"]]
        rec["pf"] += g["pts"]
        if g["result"] == "W": rec["w"] += 1
        elif g["result"] == "L": rec["l"] += 1
        else: rec["t"] += 1
    # add median bonus
    for w in reg_weeks:
        ms = sd["matchups"][w]
        scores = [(m["roster_id"], m.get("points") or 0) for m in ms if m.get("points") is not None]
        if not scores:
            continue
        med = median([p for _, p in scores])
        for rid, pts in scores:
            rec = median_rec[rid]
            if pts > med: rec["w"] += 1
            elif pts < med: rec["l"] += 1
            else: rec["t"] += 1

    # ---- No trades (reassign traded players' output back to original team) ---
    # Build adjusted weekly scores from actual points, then swap traded players'
    # weekly output (while started by acquirer) back to the team that dealt them.
    actual_week_pts = {}   # week -> rid -> pts
    starters_by = {}       # week -> rid -> set(starters)
    for w in reg_weeks:
        ms = sd["matchups"][w]
        actual_week_pts[w] = {m["roster_id"]: (m.get("points") or 0) for m in ms}
        starters_by[w] = {m["roster_id"]: set(m.get("starters") or []) for m in ms}

    # collect trades: pid -> {acquirer, origin}
    trade_moves = []
    n_trades = 0
    for w, txs in (sd.get("transactions_by_week") or {}).items():
        for t in txs:
            if t.get("type") != "trade" or t.get("status") != "complete":
                continue
            n_trades += 1
            adds = t.get("adds") or {}; drops = t.get("drops") or {}
            for pid, acq in adds.items():
                origin = drops.get(pid)
                if origin is not None and origin != acq:
                    trade_moves.append({"pid": str(pid), "acq": acq, "origin": origin})

    delta_week = {w: {rid: 0.0 for rid in rid_name} for w in reg_weeks}
    for w in reg_weeks:
        wk = load_weekly(sd["season"], w)
        for mv in trade_moves:
            pid = mv["pid"]
            # was the player started by the acquirer this week?
            if pid in starters_by[w].get(mv["acq"], set()):
                pts = (wk.get(pid) or {}).get("ppr", 0)
                if pts:
                    delta_week[w][mv["acq"]] -= pts
                    delta_week[w][mv["origin"]] += pts

    no_trade = skel()
    for w in reg_weeks:
        ms = sd["matchups"][w]
        by_mid = {}
        for m in ms:
            if m.get("matchup_id") is None:
                continue
            by_mid.setdefault(m["matchup_id"], []).append(m)
        for mid, pair in by_mid.items():
            if len(pair) != 2:
                continue
            a, b = pair
            ap = actual_week_pts[w].get(a["roster_id"], 0) + delta_week[w][a["roster_id"]]
            bp = actual_week_pts[w].get(b["roster_id"], 0) + delta_week[w][b["roster_id"]]
            for me, mp, op in ((a, ap, bp), (b, bp, ap)):
                rec = no_trade[me["roster_id"]]
                rec["pf"] += mp
                if mp > op: rec["w"] += 1
                elif mp < op: rec["l"] += 1
                else: rec["t"] += 1
    for rec in no_trade.values():
        rec["pf"] = round(rec["pf"], 1)

    # ---- Best ball (optimal lineup every week, using real per-player league
    # points) — removes all start/sit skill and shows pure roster strength. ----
    best_ball = skel()
    for w in reg_weeks:
        ms = sd["matchups"][w]
        wk_opt = {}
        for m in ms:
            pp = m.get("players_points") or {}
            plist = [{"pid": str(pid), "pos": pmeta(pid)["pos"], "value": pp.get(pid, 0.0)}
                     for pid in (m.get("players") or [])]
            _, opt = optimal_lineup(plist, slots)
            wk_opt[m["roster_id"]] = round(opt, 2)
        by_mid = {}
        for m in ms:
            if m.get("matchup_id") is None:
                continue
            by_mid.setdefault(m["matchup_id"], []).append(m)
        for mid, pair in by_mid.items():
            if len(pair) != 2:
                continue
            a, b = pair
            ap = wk_opt.get(a["roster_id"], 0); bp = wk_opt.get(b["roster_id"], 0)
            for me, mp, op in ((a, ap, bp), (b, bp, ap)):
                rec = best_ball[me["roster_id"]]; rec["pf"] += mp
                if mp > op: rec["w"] += 1
                elif mp < op: rec["l"] += 1
                else: rec["t"] += 1
    for rec in best_ball.values():
        rec["pf"] = round(rec["pf"], 1)

    # ---- All-play (each week vs the ENTIRE league) — removes schedule luck. ---
    all_play = skel()
    for w in reg_weeks:
        scores = [(m["roster_id"], m.get("points") or 0)
                  for m in sd["matchups"][w] if m.get("points") is not None]
        for rid, pts in scores:
            rec = all_play[rid]; rec["pf"] += pts
            for orid, opts_ in scores:
                if orid == rid:
                    continue
                if pts > opts_: rec["w"] += 1
                elif pts < opts_: rec["l"] += 1
                else: rec["t"] += 1
    for rec in all_play.values():
        rec["pf"] = round(rec["pf"], 1)

    # actual standings for reference
    actual = []
    for x in sd["_standings"]:
        actual.append({"team": x["team"], "rank": x["rank"],
                       "record": f"{x['wins']}-{x['losses']}" + (f"-{x['ties']}" if x['ties'] else ""),
                       "pf": x["pf"]})

    # ---- Playoff seeding: record-only vs actual division-based --------------
    # The league uses divisions with playoff_seed_type 0, which awards the top
    # seeds to division winners. Record-only ignores divisions entirely.
    lsettings = sd["league"].get("settings", {}) or {}
    n_playoff = lsettings.get("playoff_teams") or 6
    divisions = lsettings.get("divisions") or 0
    rid_div = {r["roster_id"]: (r.get("settings", {}) or {}).get("division") for r in sd["rosters"]}

    # standings are already sorted by wins then PF → pure record order
    record_order = [x["roster_id"] for x in sd["_standings"]]
    record_seed = {rid: i + 1 for i, rid in enumerate(record_order)}

    div_winner_rids = []
    if divisions and divisions > 1:
        seen_div = {}
        for rid in record_order:                # standings order = best record first
            d = rid_div.get(rid)
            if d is not None and d not in seen_div:
                seen_div[d] = rid               # best record in each division
        div_winner_rids = sorted(seen_div.values(), key=lambda rid: record_order.index(rid))
        actual_order = div_winner_rids + [rid for rid in record_order if rid not in div_winner_rids]
    else:
        actual_order = record_order[:]
    actual_seed = {rid: i + 1 for i, rid in enumerate(actual_order)}

    by_rid = {x["roster_id"]: x for x in sd["_standings"]}
    seeding_rows = []
    for rid in record_order:                    # display in record order
        x = by_rid[rid]
        seeding_rows.append({
            "team": x["team"],
            "record": f"{x['wins']}-{x['losses']}" + (f"-{x['ties']}" if x['ties'] else ""),
            "pf": x["pf"],
            "record_seed": record_seed[rid],
            "actual_seed": actual_seed[rid],
            "div_winner": rid in div_winner_rids,
            "in_record": record_seed[rid] <= n_playoff,
            "made_actual": actual_seed[rid] <= n_playoff,
        })

    return {
        "season": sd["season"],
        "have_weekly": have_weekly,
        "actual": actual,
        "scoring": {k: _rank_records(v) for k, v in scoring.items()},
        "median": _rank_records(median_rec),
        "no_trades": _rank_records(no_trade),
        "best_ball": _rank_records(best_ball),
        "all_play": _rank_records(all_play),
        "trade_count": n_trades,
        "seeding": {"playoff_teams": n_playoff, "divisions": divisions, "rows": seeding_rows},
    }

# -- Current league resolution (season-rollover proof) -----------------------
def resolve_current_league():
    """Find the most recent season's league in our family. Falls back to the
    anchor when no newer season exists yet (offseason / before league created)."""
    anchor_lg = fetch(f"{API}/league/{ANCHOR_LEAGUE_ID}")
    if not anchor_lg:
        return ANCHOR_LEAGUE_ID
    try:
        anchor_season = int(anchor_lg.get("season") or 0)
    except Exception:
        anchor_season = 0

    state = fetch(f"{API}/state/nfl") or {}
    try:
        cur_season = int(state.get("season"))
    except Exception:
        cur_season = anchor_season

    u = fetch(f"{API}/user/{TARGET_USERNAME}")
    uid = u.get("user_id") if u else None
    if not uid or cur_season <= anchor_season:
        return ANCHOR_LEAGUE_ID

    lcache = {}
    def lg(i):
        if i not in lcache:
            lcache[i] = fetch(f"{API}/league/{i}")
        return lcache[i]
    def is_ours(lid):
        node, seen = lid, set()
        while node and node not in seen:
            if node == ANCHOR_LEAGUE_ID:
                return True
            seen.add(node)
            g = lg(node)
            if not g:
                break
            node = g.get("previous_league_id")
        return False

    # Newest season first; pick the most recent of our leagues that actually has
    # something to show. A brand-new season sits in "pre_draft" with no draft,
    # roster, or games — skip it so the site keeps showing the last real season
    # until the new one drafts / kicks off.
    READY = {"drafting", "in_season", "complete"}
    for s in range(cur_season, anchor_season - 1, -1):
        leagues = fetch(f"{API}/user/{uid}/leagues/nfl/{s}") or []
        for L in leagues:
            lid = L.get("league_id")
            if not is_ours(lid):
                continue
            status = (lg(lid) or {}).get("status")
            if status not in READY:
                print(f"  skipping {s} league (status={status}) — not started yet")
                continue
            print(f"  resolved current league: {s} ({lid}, status={status})")
            return lid
    return ANCHOR_LEAGUE_ID

# -- Last-week recap ----------------------------------------------------------
def build_recap(sd, _all_games):
    users = sd["users"]
    rid_name = {r["roster_id"]: team_name(r, users) for r in sd["rosters"]}

    def week_has_games(ms):
        by_mid = {}
        for m in ms:
            if m.get("matchup_id") is None:
                continue
            by_mid.setdefault(m["matchup_id"], []).append(m)
        return any(len(p) == 2 and any((x.get("points") or 0) > 0 for x in p) for p in by_mid.values())

    played = [w for w, ms in sd["matchups"].items() if week_has_games(ms)]
    if not played:
        return {"has_data": False, "season": sd["season"], "status": sd["league"].get("status")}
    week = max(played)
    ms = sd["matchups"][week]

    by_mid = {}
    for m in ms:
        if m.get("matchup_id") is None:
            continue
        by_mid.setdefault(m["matchup_id"], []).append(m)

    games, team_scores = [], []
    for mid, pair in by_mid.items():
        if len(pair) != 2:
            continue
        a, b = pair
        ap = round(a.get("points") or 0, 2); bp = round(b.get("points") or 0, 2)
        an, bn = rid_name.get(a["roster_id"]), rid_name.get(b["roster_id"])
        games.append({"t1": an, "t1_pts": ap, "t2": bn, "t2_pts": bp,
                      "winner": an if ap > bp else bn if bp > ap else None,
                      "margin": round(abs(ap - bp), 2), "total": round(ap + bp, 2)})
        team_scores += [(an, ap), (bn, bp)]
    if not team_scores:
        return {"has_data": False, "season": sd["season"], "status": sd["league"].get("status")}

    high = max(team_scores, key=lambda x: x[1])
    low = min(team_scores, key=lambda x: x[1])
    blowout = max(games, key=lambda g: g["margin"]) if games else None
    decided = [g for g in games if g["winner"]]
    nail = min(decided, key=lambda g: g["margin"]) if decided else None
    med = median([s for _, s in team_scores])

    winners, losers = [], []
    for g in games:
        if not g["winner"]:
            continue
        if g["winner"] == g["t1"]:
            winners.append((g["t1"], g["t1_pts"])); losers.append((g["t2"], g["t2_pts"]))
        else:
            winners.append((g["t2"], g["t2_pts"])); losers.append((g["t1"], g["t1_pts"]))
    unlucky = max(losers, key=lambda x: x[1]) if losers else None
    lucky = min(winners, key=lambda x: x[1]) if winners else None

    performers = []
    for m in ms:
        pp = m.get("players_points") or {}
        for pid in (m.get("starters") or []):
            pts = pp.get(pid)
            if pts is None:
                continue
            meta = pmeta(pid)
            performers.append({"player": meta["name"], "pos": meta["pos"], "nfl_team": meta["team"],
                               "pid": str(pid), "pts": round(pts, 2), "fantasy_team": rid_name.get(m["roster_id"])})
    performers.sort(key=lambda x: -x["pts"])

    above = sorted([t for t in team_scores if t[1] > med], key=lambda x: -x[1])
    return {
        "has_data": True, "season": sd["season"], "week": week,
        "status": sd["league"].get("status"),
        "is_regular": week < sd["playoff_start"],
        "games": sorted(games, key=lambda g: -g["total"]),
        "high": {"team": high[0], "pts": high[1]},
        "low": {"team": low[0], "pts": low[1]},
        "blowout": blowout, "nailbiter": nail, "median": round(med, 2),
        "above_median": [t[0] for t in above],
        "unlucky": ({"team": unlucky[0], "pts": unlucky[1]} if unlucky else None),
        "lucky": ({"team": lucky[0], "pts": lucky[1]} if lucky else None),
        "top_players": performers[:12],
    }

# -- Waiver wire --------------------------------------------------------------
def build_waivers(sd):
    users = sd["users"]
    rosters = sd["rosters"]
    season = sd["season"]
    stats = load_stats(season)
    gpmap = STATS_GP.get(season, {})
    rid_name = {r["roster_id"]: team_name(r, users) for r in rosters}
    lset = sd["league"].get("settings", {}) or {}
    budget = lset.get("waiver_budget") or 0
    # waiver_type 2 = FAAB; anything else is priority-based (reverse standings)
    is_faab = lset.get("waiver_type") == 2 and budget > 0

    # Waiver order / FAAB
    order = []
    for r in sorted(rosters, key=lambda r: (r.get("settings", {}) or {}).get("waiver_position", 99)):
        s = r.get("settings", {}) or {}
        oid = r.get("owner_id")
        row = {"team": rid_name.get(r["roster_id"]), "owner": owner_name(users, oid),
               "color": team_color(oid), "owner_id": oid,
               "position": s.get("waiver_position")}
        if is_faab:
            used = s.get("waiver_budget_used", 0) or 0
            row["faab_used"] = used; row["faab_left"] = budget - used; row["faab_total"] = budget
        order.append(row)

    # Rostered set across the league
    rostered = {}
    for r in rosters:
        for pid in (r.get("players") or []):
            rostered[str(pid)] = rid_name.get(r["roster_id"])

    # Best available (top season scorers nobody rostered)
    SKILL = ("QB", "RB", "WR", "TE", "K", "DEF")
    avail = []
    for pid, ppr in stats.items():
        if pid in rostered or ppr <= 0:
            continue
        m = pmeta(pid)
        if m["pos"] not in SKILL:
            continue
        g = gpmap.get(pid, 0) or 0
        avail.append({"pid": pid, "player": m["name"], "pos": m["pos"], "nfl_team": m["team"],
                      "pts_ppr": ppr, "ppg": round(ppr / g, 1) if g else 0.0,
                      "injury": m.get("injury") or ""})
    avail.sort(key=lambda x: -x["pts_ppr"])
    best_by_pos = {}
    for pos in SKILL:
        best_by_pos[pos] = [a for a in avail if a["pos"] == pos][:8]
    best_overall = avail[:15]

    # Trending adds / drops (league-agnostic, last 24h)
    def trending(kind):
        data = fetch(f"{API}/players/nfl/trending/{kind}?lookback_hours=24&limit=25") or []
        rows = []
        for t in (data or []):
            pid = str(t.get("player_id"))
            m = pmeta(pid)
            if m["pos"] == "?" and m["name"].startswith("#"):
                continue
            rows.append({"pid": pid, "player": m["name"], "pos": m["pos"], "nfl_team": m["team"],
                         "count": t.get("count"), "injury": m.get("injury") or "",
                         "rostered_by": rostered.get(pid)})
        return rows[:15]

    # Recent waiver / FA activity
    feed = build_transactions(sd, rid_name)
    moves = [t for t in feed if t.get("type") in ("waiver", "free_agent")][:30]

    return {
        "season": season, "status": sd["league"].get("status"),
        "is_faab": bool(is_faab), "budget": budget,
        "waiver_type": lset.get("waiver_type"),
        "waiver_day": lset.get("waiver_day_of_week"),
        "order": order,
        "best_available": best_by_pos, "best_overall": best_overall,
        "trending_add": trending("add"), "trending_drop": trending("drop"),
        "recent_moves": moves,
    }

# -- Sitemap (auto-generated each run) ----------------------------------------
# Default derives from OUT_DIR (which is <docroot>/sleeper/data on the server).
# Overridable for local dev — and the sitemap step below guards against a
# degenerate value so a scratch SC_OUT_DIR can never os.walk an unintended tree.
DOCROOT = os.environ.get("SC_DOCROOT", os.path.dirname(os.path.dirname(OUT_DIR)))  # .../www-data
SITE_BRAND = os.environ.get("SITE_BRAND", "GGGG")  # label shown on the generated sitemap

PAGE_DESC = {
    "index.html": ("Home", "Server landing page with quick links to everything."),
    "sitemap.html": ("Sitemap", "This page — every page on the site, generated automatically."),
    "resources/about.html": ("About", "Notes about the server hosting this site."),
    "sleeper/index.html": ("Fantasy · League", "Standings, final scoreboard, playoff bracket, power rankings, all-time records, head-to-head grid, transactions and league history."),
    "sleeper/recap.html": ("Fantasy · Last Week", "The most recent week recapped: top and low scores, biggest blowout, closest game, lucky/unlucky teams and the week's best performers."),
    "sleeper/matchups.html": ("Fantasy · Matchups", "Browse any week of any season: pick a team and see that week's matchup with both full lineups, points by slot, the bench, and the optimal lineup."),
    "sleeper/waivers.html": ("Fantasy · Waiver Wire", "Waiver priority order, Sleeper-wide trending adds and drops, best available unrostered players by position, and recent pickups."),
    "sleeper/teams.html": ("Fantasy · Teams", "Index of every manager with all-time records, titles and quick links to their team page."),
    "sleeper/team.html": ("Fantasy · Team", "Per-manager dashboard (uniquely themed) with a recommended lineup, weekly lineup efficiency, and the complete season-by-season roster history."),
    "sleeper/draft.html": ("Fantasy · Draft", "Per-season snake-draft board with hindsight steals and busts and draft grades."),
    "sleeper/whatif.html": ("Fantasy · What-If", "Alternate-reality standings: different scoring systems, a no-trades season, the median format, and record-based playoff seeding."),
    "sleeper/trade.html": ("Fantasy · Trade What-If", "Draft a hypothetical trade between any two teams and see both resulting rosters, the optimal-lineup impact, value exchanged, positional changes and a neutral balance read."),
    "sleeper/changelog.html": ("Fantasy · Changelog", "Every change made to the site, explained in depth."),
    "nba/index.html": ("Basketball · League", "Standings, scoreboard, playoff bracket, power rankings, records, head-to-head grid, transactions and league history."),
    "nba/recap.html": ("Basketball · Last Week", "The most recent week recapped: top and low scores, biggest blowout, closest game, lucky/unlucky teams and the week's best performers."),
    "nba/matchups.html": ("Basketball · Matchups", "Browse any week of any season: pick a team and see that week's matchup with both full lineups, points by slot, the bench, and the optimal lineup."),
    "nba/waivers.html": ("Basketball · Waiver Wire", "FAAB budgets, Sleeper-wide trending adds and drops, best available unrostered players by position, and recent pickups."),
    "nba/teams.html": ("Basketball · Teams", "Index of every manager with all-time records, titles and quick links to their team page."),
    "nba/team.html": ("Basketball · Team", "Per-manager dashboard (uniquely themed) with a recommended lineup, weekly lineup efficiency, and the complete season-by-season roster history."),
    "nba/draft.html": ("Basketball · Draft", "Per-season draft board with hindsight steals and busts and draft grades."),
    "nba/whatif.html": ("Basketball · What-If", "Alternate-reality standings: a best-ball season, a no-trades season, the median format, and record-based playoff seeding."),
    "nba/trade.html": ("Basketball · Trade What-If", "Draft a hypothetical trade between any two teams and see both resulting rosters, the optimal-lineup impact, value exchanged, positional changes and a neutral balance read."),
    "nba/changelog.html": ("Basketball · Changelog", "Every change made to the basketball section, explained in depth."),
}

def build_sitemap(meta):
    pages = []
    for dirpath, dirnames, filenames in os.walk(DOCROOT):
        if "_old" in dirpath or os.sep + "data" in dirpath:
            continue
        for fn in filenames:
            if not fn.endswith(".html"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), DOCROOT).replace(os.sep, "/")
            pages.append(rel)
    hoops = sorted([p for p in pages if p.startswith("nba/")])
    fantasy = sorted([p for p in pages if p.startswith("sleeper/")])
    site = sorted([p for p in pages if not p.startswith("sleeper/") and not p.startswith("nba/")])

    def card(rel):
        title, desc = PAGE_DESC.get(rel, (rel.split("/")[-1].replace(".html", "").title(), ""))
        return (f'<a class="sm-card" href="/{rel}"><div class="sm-title">{title}'
                f'<span class="sm-path">/{rel}</span></div>'
                f'<div class="sm-desc">{desc}</div></a>')

    gen = meta.get("generated_human", "")
    hoops_html = "".join(card(p) for p in hoops)
    fan_html = "".join(card(p) for p in fantasy)
    site_html = "".join(card(p) for p in site)
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sitemap · {SITE_BRAND}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0e0e10;color:#ddd8cc;font-family:Helvetica,Arial,sans-serif;
line-height:1.5;padding:48px 20px 80px}}
.wrap{{max-width:820px;margin:0 auto}}
.eyebrow{{font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#5b8dd9;font-weight:bold;margin-bottom:10px}}
h1{{font-size:clamp(30px,6vw,48px);font-weight:bold;letter-spacing:-.01em;margin-bottom:8px}}
.sub{{color:#7a7570;margin-bottom:6px}}
.upd{{color:#7a7570;font-size:12px;margin-bottom:36px}}
.label{{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#3a6aaf;
font-weight:bold;border-bottom:1px solid #2a2a30;padding-bottom:8px;margin:0 0 16px}}
.grid{{display:grid;gap:12px;margin-bottom:40px}}
.sm-card{{display:block;background:#16161a;border:1px solid #2a2a30;border-radius:14px;
padding:18px 20px;text-decoration:none;color:#ddd8cc;transition:border-color .2s,transform .2s}}
.sm-card:hover{{border-color:#5b8dd9;transform:translateX(4px)}}
.sm-title{{font-weight:bold;font-size:17px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}}
.sm-path{{font-size:12px;color:#7a7570;font-weight:normal}}
.sm-desc{{color:#9a948a;font-size:14px;margin-top:5px}}
a.back{{color:#5b8dd9;text-decoration:none;font-size:14px}}
</style></head><body><div class="wrap">
<p class="eyebrow">{SITE_BRAND}</p><h1>Sitemap</h1>
<p class="sub">Every page on the site. This list regenerates automatically whenever the fantasy data refreshes.</p>
<p class="upd">Generated {gen}</p>
<p class="label" style="color:#a5312b">Fantasy Basketball · DMG</p><div class="grid">{hoops_html}</div>
<p class="label">Fantasy Football · GGGG</p><div class="grid">{fan_html}</div>
<p class="label">Site</p><div class="grid">{site_html}</div>
<p><a class="back" href="/index.html">&larr; Home</a></p>
</div></body></html>"""

# -- Matchup browser data (per season, every played week) --------------------
def build_matchups(sd):
    users = sd["users"]
    rosters = sd["rosters"]
    slots = starting_slots(sd["league"])
    rid_name = {r["roster_id"]: team_name(r, users) for r in rosters}
    rid_owner = {r["roster_id"]: r.get("owner_id") for r in rosters}
    rid_color = {r["roster_id"]: team_color(r.get("owner_id")) for r in rosters}
    nm = nick_map(rosters)

    def side(m):
        pp = m.get("players_points") or {}
        starters = m.get("starters") or []
        starter_set = set(starters)
        nd = nm.get(rid_owner.get(m["roster_id"]), {})
        rows = []
        for i, pid in enumerate(starters):
            mm = pmeta(pid)
            rows.append({"pid": str(pid), "name": mm["name"], "nick": nd.get(str(pid)) or "", "pos": mm["pos"], "nfl_team": mm["team"],
                         "slot": slots[i] if i < len(slots) else "FLEX",
                         "pts": round(pp.get(pid, 0.0), 2), "starter": True, "injury": mm.get("injury") or ""})
        for pid in (m.get("players") or []):
            if pid in starter_set:
                continue
            mm = pmeta(pid)
            rows.append({"pid": str(pid), "name": mm["name"], "nick": nd.get(str(pid)) or "", "pos": mm["pos"], "nfl_team": mm["team"],
                         "slot": "BN", "pts": round(pp.get(pid, 0.0), 2), "starter": False, "injury": mm.get("injury") or ""})
        plist = [{"pid": str(pid), "pos": pmeta(pid)["pos"], "value": pp.get(pid, 0.0)} for pid in (m.get("players") or [])]
        _, opt = optimal_lineup(plist, slots)
        rid = m["roster_id"]
        return {"roster_id": rid, "team": rid_name.get(rid), "owner": owner_name(users, rid_owner.get(rid)),
                "owner_id": rid_owner.get(rid), "color": rid_color.get(rid),
                "points": round(m.get("points") or 0, 2), "optimal": round(opt, 1), "players": rows}

    weeks = {}
    for w, ms in sd["matchups"].items():
        by_mid = {}
        for m in ms:
            if m.get("matchup_id") is None:
                continue
            by_mid.setdefault(m["matchup_id"], []).append(m)
        games = []
        for mid, pair in by_mid.items():
            if len(pair) != 2 or not any((m.get("points") or 0) > 0 for m in pair):
                continue
            a, b = side(pair[0]), side(pair[1])
            a["result"] = "W" if a["points"] > b["points"] else "L" if a["points"] < b["points"] else "T"
            b["result"] = "W" if b["points"] > a["points"] else "L" if b["points"] < a["points"] else "T"
            games.append({"matchup_id": mid, "a": a, "b": b})
        if games:
            weeks[str(w)] = games

    teams = [{"roster_id": r["roster_id"], "team": rid_name.get(r["roster_id"]),
              "owner": owner_name(users, r.get("owner_id")), "owner_id": r.get("owner_id"),
              "color": rid_color.get(r["roster_id"])} for r in rosters]
    return {"season": sd["season"], "playoff_start": sd["playoff_start"],
            "weeks_list": sorted(weeks.keys(), key=int), "teams": teams, "weeks": weeks}

# -- Trade what-if data -------------------------------------------------------
def build_trade(sd):
    users = sd["users"]
    rosters = sd["rosters"]
    season = sd["season"]
    stats = load_stats(season)
    gpmap = STATS_GP.get(season, {})
    slots = starting_slots(sd["league"])
    use_proj = bool(PROJ) and PROJ_META.get("available")

    teams = []
    for r in rosters:
        rid = r["roster_id"]; oid = r.get("owner_id")
        starters = set(r.get("starters") or [])
        plist = []
        for pid in (r.get("players") or []):
            pid = str(pid); mm = pmeta(pid)
            ppr = stats.get(pid, 0.0); g = gpmap.get(pid, 0) or 0
            ppg = round(ppr / g, 2) if g else 0.0
            proj = PROJ.get(pid, 0.0)
            plist.append({"pid": pid, "name": mm["name"], "pos": mm["pos"], "nfl_team": mm["team"],
                          "proj": proj, "ppg": ppg, "pts_ppr": ppr, "injury": mm.get("injury") or "",
                          "starter": pid in starters})
        plist.sort(key=lambda p: -(p["proj"] if use_proj else p["ppg"]))
        teams.append({"roster_id": rid, "owner_id": oid, "team": team_name(r, users),
                      "owner": owner_name(users, oid), "color": team_color(oid), "players": plist})
    teams.sort(key=lambda t: t["team"].lower())
    return {"season": season, "slots": slots, "use_projections": use_proj,
            "proj_week": PROJ_META.get("week"),
            "flex_map": {k: sorted(v) for k, v in FLEX_MAP.items()},
            "teams": teams}

# -- Main ---------------------------------------------------------------------
# -- Player pages: per-player game logs across every recorded season ---------
def build_player_data(chain):
    """Game logs for every player ever rostered in the league, derived ENTIRELY
    from matchup data already fetched during this build (no extra Sleeper calls).
    Each log row notes the season/week, the FF team that rostered them at the
    time, whether they were started, their league-scored points, and playoff
    flag. Returns (players_by_pid, index_rows)."""
    logs = {}   # pid -> [game rows]
    for sd in chain:
        season = sd["season"]
        users = sd["users"]
        rid_name = sd.get("_rid_name") or {r["roster_id"]: team_name(r, users) for r in sd["rosters"]}
        rid_owner = {r["roster_id"]: r.get("owner_id") for r in sd["rosters"]}
        ps = sd["playoff_start"]
        week_stats = {int(w): load_weekly(season, w) for w in sd["matchups"]}
        for w, ms in sd["matchups"].items():
            wk = int(w)
            wst = week_stats.get(wk) or {}
            for m in ms:
                if not any((v or 0) > 0 for v in (m.get("players_points") or {}).values()):
                    continue  # unplayed week — skip
                pp = m.get("players_points") or {}
                starters = set(m.get("starters") or [])
                rid = m["roster_id"]
                for pid in (m.get("players") or []):
                    logs.setdefault(str(pid), []).append({
                        "season": season, "week": wk,
                        "team": rid_name.get(rid), "owner_id": rid_owner.get(rid),
                        "started": pid in starters,
                        "pts": round(pp.get(pid, 0.0), 2),
                        "playoff": wk >= ps,
                        "st": (wst.get(str(pid)) or {}).get("raw") or {},
                    })

    players_out, index = {}, []
    for pid, gl in logs.items():
        gl.sort(key=lambda g: (g["season"], g["week"]))
        mm = pmeta(pid)
        started = [g for g in gl if g["started"]]
        tot = round(sum(g["pts"] for g in started), 1)
        seasons = sorted({g["season"] for g in gl}, reverse=True)
        teams = []
        for g in gl:
            if g["team"] and g["team"] not in teams:
                teams.append(g["team"])
        best = max(started, key=lambda g: g["pts"], default=None)
        byes = {s: load_team_byes(s).get(mm["team"]) for s in seasons if load_team_byes(s).get(mm["team"])}
        players_out[pid] = {
            "pid": pid, "name": mm["name"], "pos": mm["pos"], "nfl_team": mm["team"],
            "injury": mm.get("injury") or "", "age": mm.get("age"),
            "byes": byes,
            "summary": {
                "games": len(gl), "started": len(started), "started_pts": tot,
                "ppg_started": round(tot / len(started), 1) if started else 0,
                "seasons": seasons, "teams": teams,
                "best": ({"pts": best["pts"], "season": best["season"], "week": best["week"],
                          "team": best["team"]} if best else None),
            },
            "log": list(reversed(gl)),   # newest first
        }
        index.append({"pid": pid, "name": mm["name"], "pos": mm["pos"],
                      "nfl_team": mm["team"], "g": len(gl), "gs": len(started), "pts": tot})
    index.sort(key=lambda r: r["name"] or "")
    return players_out, index


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Loading players DB…")
    load_players()

    # Walk the history chain from the dynamically-resolved current league
    print("Resolving current league…")
    start_lid = resolve_current_league()
    print("Walking league history chain…")
    chain = []
    lid = start_lid
    seen = set()
    while lid and lid not in seen and len(chain) < MAX_SEASONS:
        seen.add(lid)
        sd = gather_season(lid)
        if not sd:
            break
        print(f"  • {sd['season']}  ({lid})")
        chain.append(sd)
        lid = sd["league"].get("previous_league_id")

    if not chain:
        print("No data; aborting.", file=sys.stderr)
        sys.exit(1)

    current = chain[0]

    # Resolve target owner id from current season
    target_owner_id = None
    for r in current["rosters"]:
        if owner_name(current["users"], r.get("owner_id")).lower() == TARGET_USERNAME.lower():
            target_owner_id = r["owner_id"]; break
    if not target_owner_id:
        u = fetch(f"{API}/user/{TARGET_USERNAME}")
        target_owner_id = u.get("user_id") if u else None

    # Per-season derived; accumulate all games for all-time h2h/records
    all_games = []
    owner_disp = {}
    history_rows = {}   # owner_id -> aggregate
    season_summaries = []

    per_season_payloads = {}

    for sd in chain:
        games, allplay, rid_name, rid_owner = compute_games(sd)
        all_games.extend(games)
        standings = build_standings(sd, games, allplay, rid_name)
        sd["_standings"] = standings
        sd["_games"] = games
        sd["_rid_name"] = rid_name

        for u in sd["users"]:
            owner_disp[u["user_id"]] = u.get("display_name") or u.get("username") or "Unknown"

        # season champion via winners bracket final (place 1)
        champ = runner = None
        for e in sd["winners"]:
            if e.get("p") == 1:
                champ = rid_name.get(e.get("w")); runner = rid_name.get(e.get("l"))
        reg_winner = standings[0]["team"] if standings else None
        season_summaries.append({
            "season": sd["season"], "league_id": sd["league_id"],
            "champion": champ, "runner_up": runner, "regular_season": reg_winner,
            "teams": sd["league"].get("total_rosters"),
            "status": sd["league"].get("status"),
        })

        # all-time aggregate per owner
        for r in sd["rosters"]:
            oid = r.get("owner_id")
            st = r.get("settings", {}) or {}
            agg = history_rows.setdefault(oid, {"owner": owner_disp.get(oid, "Unknown"),
                                                "avatar": avatar_url(sd["users"], oid),
                                                "seasons": 0, "wins": 0, "losses": 0, "ties": 0,
                                                "pf": 0.0, "championships": 0, "best_finish": 99})
            agg["seasons"] += 1
            agg["wins"] += st.get("wins", 0); agg["losses"] += st.get("losses", 0); agg["ties"] += st.get("ties", 0)
            agg["pf"] += float(st.get("fpts", 0)) + float(st.get("fpts_decimal", 0)) / 100.0
            rank = next((x["rank"] for x in standings if x["roster_id"] == r["roster_id"]), 99)
            agg["best_finish"] = min(agg["best_finish"], rank)

        # championship credit
        for e in sd["winners"]:
            if e.get("p") == 1 and e.get("w"):
                wrid = e.get("w")
                wroster = next((r for r in sd["rosters"] if r["roster_id"] == wrid), None)
                if wroster:
                    history_rows.setdefault(wroster["owner_id"], {})  # ensure
                    history_rows[wroster["owner_id"]]["championships"] = history_rows[wroster["owner_id"]].get("championships", 0) + 1

    # Build current-season payloads
    cur = current
    standings = cur["_standings"]
    rid_name = cur["_rid_name"]
    cur_games = [g for g in cur["_games"]]

    power = build_power(standings)
    # records computed over the full history: games span all seasons, and
    # luckiest/most-PF are drawn from every season's standings (season-labeled)
    all_standings = [row for sd in chain for row in sd["_standings"]]
    records = build_records(all_games, all_standings)
    h2h = build_h2h(all_games, owner_disp)
    bracket = {"winners": build_bracket(cur["winners"], rid_name),
               "losers": build_bracket(cur["losers"], rid_name)}
    tx_feed = build_transactions(cur, rid_name)
    cur["_tx"] = tx_feed

    # Build a draft recap for every season that has one
    drafts_by_season = {}
    for sd in chain:
        d = build_draft(sd)
        if d:
            drafts_by_season[sd["season"]] = d
    draft = drafts_by_season.get(cur["season"])
    cur["_draft"] = draft
    draft_seasons = list(drafts_by_season.keys())  # newest first (chain order)

    # last completed week scoreboard: highest week that has a real paired matchup
    # with points (week 18 has NFL scores but no fantasy pairings, so it's skipped)
    def week_games(ms):
        by_mid = {}
        for m in ms:
            if m.get("matchup_id") is None:
                continue
            by_mid.setdefault(m["matchup_id"], []).append(m)
        out = []
        for mid, pair in by_mid.items():
            if len(pair) == 2 and any((m.get("points") or 0) > 0 for m in pair):
                a, b = pair
                ap, bp = a.get("points") or 0, b.get("points") or 0
                out.append({
                    "t1": rid_name.get(a["roster_id"]), "t1_pts": round(ap, 2),
                    "t2": rid_name.get(b["roster_id"]), "t2_pts": round(bp, 2),
                    "winner": rid_name.get(a["roster_id"]) if ap > bp else rid_name.get(b["roster_id"]) if bp > ap else None,
                })
        return out

    scoreboard = {"week": 0, "games": []}
    for w in sorted(cur["matchups"].keys(), reverse=True):
        g = week_games(cur["matchups"][w])
        if g:
            scoreboard = {"week": w, "games": g}
            break

    league_payload = {
        "meta": {
            "league_id": cur["league_id"], "name": cur["league"].get("name"),
            "season": cur["season"], "status": cur["league"].get("status"),
            "total_rosters": cur["league"].get("total_rosters"),
            "scoring": "Full PPR" if (cur["league"].get("scoring_settings", {}) or {}).get("rec") == 1 else "Custom",
            "roster_positions": starting_slots(cur["league"]),
            "bench_slots": sum(1 for p in (cur["league"].get("roster_positions") or []) if p == "BN"),
            "playoff_teams": (cur["league"].get("settings", {}) or {}).get("playoff_teams"),
            "playoff_week_start": (cur["league"].get("settings", {}) or {}).get("playoff_week_start"),
            "divisions": (cur["league"].get("settings", {}) or {}).get("divisions"),
            "scoring_detail": {k: (cur["league"].get("scoring_settings", {}) or {}).get(k)
                               for k in ("rec", "pass_td", "pass_yd", "rush_td", "rec_td", "bonus_rec_te", "fum_lost", "pass_int")
                               if (cur["league"].get("scoring_settings", {}) or {}).get(k) is not None},
        },
        "standings": standings,
        "scoreboard": scoreboard,
        "power_rankings": power,
        "records": records,
        "h2h": h2h,
        "bracket": bracket,
        "transactions": tx_feed,
    }

    # History payload
    all_time = []
    for oid, agg in history_rows.items():
        if "seasons" not in agg:
            continue
        agg["pf"] = round(agg["pf"], 1)
        agg["owner"] = owner_disp.get(oid, agg.get("owner", "Unknown"))
        agg.setdefault("championships", 0)
        gp = agg["wins"] + agg["losses"] + agg["ties"]
        agg["win_pct"] = round(agg["wins"] / gp, 3) if gp else 0
        all_time.append(agg)
    all_time.sort(key=lambda x: (-x["championships"], -x["win_pct"], -x["pf"]))

    history_payload = {
        "seasons": season_summaries,
        "all_time": all_time,
        "h2h": h2h,
    }

    # Per-team payloads (every owner who ever appears in the chain)
    # Upcoming-week projections for the recommended lineup
    nfl_state = fetch(f"{API}/state/nfl") or {}
    proj_season = nfl_state.get("season") or cur["season"]
    try:
        proj_week = int(nfl_state.get("week") or 0) or 1
    except Exception:
        proj_week = 1
    global PROJ, PROJ_META
    PROJ = load_projections(proj_season, proj_week)
    PROJ_META = {"season": proj_season, "week": proj_week, "available": bool(PROJ)}
    print(f"  projections {proj_season} wk{proj_week}: {len(PROJ)} players")

    print("Building team pages…")
    all_owner_ids = []
    for sd in chain:
        for r in sd["rosters"]:
            oid = r.get("owner_id")
            if oid and oid not in all_owner_ids:
                all_owner_ids.append(oid)
    team_payloads = []
    for oid in all_owner_ids:
        tp = build_team_full(chain, oid, all_games)
        if tp:
            team_payloads.append(tp)
    teams_index = build_teams_index(team_payloads)

    # Manager efficiency leaderboard (current season): who sets the best lineups
    mgr_eff = []
    for tp in team_payloads:
        s0 = tp["seasons"][0] if tp["seasons"] else None
        if s0 and s0["season"] == cur["season"] and s0.get("efficiency") and s0["efficiency"]["pct"] is not None:
            e = s0["efficiency"]
            mgr_eff.append({"team": s0["team_name"], "owner": tp["meta"]["owner"],
                            "color": tp["meta"].get("color"), "owner_id": tp["meta"]["owner_id"],
                            "pct": e["pct"], "left": e["left_on_bench"],
                            "optimal": e["optimal"], "actual": e["actual"]})
    mgr_eff.sort(key=lambda x: -x["pct"])
    league_payload["manager_efficiency"] = mgr_eff

    # What-if per season
    print("Computing what-if scenarios…")
    whatif_payload = {"seasons": [build_whatif_season(sd, all_games) for sd in chain]}

    # Last-week recap (current season)
    print("Building last-week recap…")
    recap_payload = build_recap(cur, all_games)

    # Waiver wire
    print("Building waiver wire…")
    waivers_payload = build_waivers(cur)

    # Matchup browser data (one file per season)
    print("Building matchup browser…")
    matchups_by_season = {}
    for sd in chain:
        mp = build_matchups(sd)
        if mp["weeks_list"]:
            matchups_by_season[sd["season"]] = mp
    matchup_seasons = list(matchups_by_season.keys())

    # Trade what-if (current season rosters)
    print("Building trade tool…")
    trade_payload = build_trade(cur)

    # NFL state + ongoing flag
    state = fetch(f"{API}/state/nfl") or {}
    league_status = cur["league"].get("status")
    is_live = league_status == "in_season"
    league_payload["meta"]["week"] = recap_payload.get("week")
    league_payload["meta"]["is_live"] = is_live

    # Meta
    now = datetime.now(timezone.utc)
    meta_payload = {
        "generated_at": now.isoformat(),
        "generated_human": now.strftime("%b %-d, %Y %H:%M UTC"),
        "seasons": [s["season"] for s in season_summaries],
        "current_league_id": cur["league_id"],
        "league_name": cur["league"].get("name"),
        "my_owner_id": target_owner_id,
        "draft_seasons": draft_seasons,
        "league_status": league_status,
        "is_live": is_live,
        "nfl_season": state.get("season"),
        "nfl_week": state.get("week"),
        "nfl_season_type": state.get("season_type"),
        "recap_week": recap_payload.get("week"),
        "recap_has_data": recap_payload.get("has_data", False),
        "matchup_seasons": matchup_seasons,
        "projections": PROJ_META,
    }

    # Write
    def write(name, payload):
        path = os.path.join(OUT_DIR, name)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(tmp, path)
        print(f"  wrote {name} ({os.path.getsize(path)} bytes)")

    print("Writing JSON…")
    write("league.json", league_payload)
    write("history.json", history_payload)
    write("draft.json", draft or {})           # latest, default
    for season, d in drafts_by_season.items():
        write(f"draft_{season}.json", d)
    write("teams.json", teams_index)
    for tp in team_payloads:
        write(f"team_{tp['meta']['owner_id']}.json", tp)
    write("whatif.json", whatif_payload)
    write("recap.json", recap_payload)
    write("waivers.json", waivers_payload)
    for season, mp in matchups_by_season.items():
        write(f"matchups_{season}.json", mp)
    write("trade.json", trade_payload)
    write("meta.json", meta_payload)

    # Player game-log pages (one small file per player) + a search index.
    players_out, players_index = build_player_data(chain)
    pdir = os.path.join(OUT_DIR, "players")
    os.makedirs(pdir, exist_ok=True)
    for pid, payload in players_out.items():
        pp = os.path.join(pdir, f"{pid}.json")
        tmp = pp + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(tmp, pp)
    write("players_index.json", players_index)
    print(f"  wrote {len(players_out)} player files")

    # Regenerate the site-wide sitemap (scans the docroot). Guard: only run when
    # DOCROOT actually looks like the docroot (contains sleeper/). This keeps a
    # misconfigured/scratch run (e.g. local SC_OUT_DIR) from os.walk-ing "/" or
    # some unrelated tree. Set SC_DOCROOT to your www dir to build it locally.
    try:
        if not os.path.isdir(os.path.join(DOCROOT, "sleeper")):
            print(f"  skipped sitemap (DOCROOT {DOCROOT!r} has no sleeper/; set SC_DOCROOT to build it)")
            print("Done.")
            return
        sm_path = os.path.join(DOCROOT, "sitemap.html")
        tmp = sm_path + ".tmp"
        with open(tmp, "w") as f:
            f.write(build_sitemap(meta_payload))
        os.replace(tmp, sm_path)
        print(f"  wrote sitemap.html ({os.path.getsize(sm_path)} bytes)")
    except Exception as e:
        print(f"  ! sitemap failed: {e}", file=sys.stderr)
    print("Done.")

if __name__ == "__main__":
    main()
