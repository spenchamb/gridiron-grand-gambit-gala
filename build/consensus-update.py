#!/usr/bin/env python3
"""
consensus-update.py  —  weekly expert-consensus start/sit rankings for the GGGG site.

Sibling of ffpros-update.py, and deliberately separate from it. That builder answers
"who is worth rostering": one global cross-position list, rest-of-season or draft
cheatsheet, rebuilt daily. This one answers "who do I start this week" — a per-position
weekly ranking, refreshed hourly in season because the list moves with the Wednesday
and Friday practice reports and again with Sunday inactives.

Scrapes the same embedded `ecrData` blob ffpros-update.py reads, but from the seven
weekly PPR position pages; resolves each ranked player to a Sleeper player_id via the
DynastyProcess crosswalk (with a normalized name+position fallback); joins the league's
current rosters so every row can say who owns him; writes data/consensus.json.

Naming note: the site's Consensus page must never name the upstream aggregator — it
republishes their weekly ranks only for the league's own tooling. Nothing this script
writes into the JSON names it either; the page renders these strings verbatim.

Offseason (nfl state season_type is not regular/post) there are no weekly ranks to
have, so the payload is written with ready=false and the page shows its empty state.
"""
import urllib.request, urllib.error, json, re, csv, io, os, sys, time, unicodedata, datetime
import hashlib, colorsys

API       = "https://api.sleeper.app/v1"
OUT_DIR   = os.environ.get("SC_OUT_DIR", "/mnt/cache/appdata/www-data/sleeper/data")
UA        = {"User-Agent": "scbeelink-consensus/1.0"}
FP_BASE   = "https://www.fantasypros.com/nfl/rankings/"
IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
AVATAR    = "https://sleepercdn.com/avatars/thumbs/"

# The seven PPR categories the weekly rankings publish, in the order the page shows
# them. QB/K/DST have no PPR variant — receptions do not touch their scoring — so
# those are the plain slugs.
POSITIONS = [
    ("qb",       "QB"),
    ("ppr-rb",   "RB"),
    ("ppr-wr",   "WR"),
    ("ppr-te",   "TE"),
    ("ppr-flex", "FLEX"),
    ("k",        "K"),
    ("dst",      "DEF"),
]

# How deep each list is worth publishing. The upstream pages rank far past the point
# anyone would start a player (468 FLEX rows in week 1), and this file is fetched in
# the browser on every page view, so the tail is paid for and never read. A player who
# is on a league roster is kept regardless of where he ranks — the whole point of the
# owner join is that you can find your own bench guy.
CAPS = {"QB": 75, "RB": 120, "WR": 150, "TE": 75, "FLEX": 200, "K": None, "DEF": None}

# Upstream position code -> Sleeper position.
POS_MAP = {"DST": "DEF"}
# Upstream team code -> Sleeper DEF pid, where they differ.
TEAM_ALIAS = {"JAC": "JAX", "WSH": "WAS", "LA": "LAR"}


def fetch_raw(url, tries=3, backoff=1.5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:
            last = e
        time.sleep(backoff * (i + 1))
    print(f"  ! failed: {url} ({last})", file=sys.stderr)
    return None


def fetch_json(url):
    raw = fetch_raw(url)
    return json.loads(raw) if raw else None


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z ]", "", s.lower())
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def num(v):
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 2)
    except (TypeError, ValueError):
        return None


def load_idmap():
    """fantasypros_id -> sleeper_id from the DynastyProcess crosswalk."""
    raw = fetch_raw(IDMAP_URL)
    m = {}
    if not raw:
        print("  ! could not load the id crosswalk", file=sys.stderr)
        return m
    for row in csv.DictReader(io.StringIO(raw)):
        fp = (row.get("fantasypros_id") or "").strip()
        sl = (row.get("sleeper_id") or "").strip()
        if fp and sl:
            m[fp] = sl
    return m


def load_sleeper_db():
    """(name_idx, def_pids, info) — same three shapes ffpros-update.py builds."""
    raw = fetch_json(f"{API}/players/nfl") or {}
    idx, teams, info = {}, set(), {}
    for pid, p in raw.items():
        if not isinstance(p, dict):
            continue
        pos = p.get("position")
        if pos == "DEF":
            teams.add(pid)
            name = (p.get("full_name") or p.get("team") or pid) + " D/ST"
            nm = norm(p.get("full_name") or p.get("team") or pid)
            team = p.get("team") or pid
        else:
            name = f"{p.get('first_name','')} {p.get('last_name','')}".strip() or pid
            nm = norm(f"{p.get('first_name','')} {p.get('last_name','')}")
            team = p.get("team") or "FA"
        if nm:
            idx.setdefault((nm, pos), pid)
        info[pid] = {"name": name, "pos": pos, "team": team,
                     "injury": (p.get("injury_status") or "").strip()}
    return idx, teams, info


def team_color(owner_id):
    """Deterministic accent per manager. Byte-identical to sleeper-update.py's, so a
       manager's dot is the same colour here as it is on every other page."""
    h = int(hashlib.md5(str(owner_id).encode()).hexdigest()[:8], 16)
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, 0.62, 0.55)
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))


def load_owners(league_id):
    """sleeper_pid -> owner tag. Empty on any failure: owner tags are additive and a
       Sleeper hiccup must never cost us the rankings themselves."""
    if not league_id:
        return {}
    rosters = fetch_json(f"{API}/league/{league_id}/rosters") or []
    users   = fetch_json(f"{API}/league/{league_id}/users") or []
    by_uid  = {u.get("user_id"): u for u in users}
    out = {}
    for r in rosters:
        oid = r.get("owner_id")
        u   = by_uid.get(oid) or {}
        md  = u.get("metadata") or {}
        tag = {
            "owner_id": oid,
            "team":     md.get("team_name") or u.get("display_name") or f"Owner {str(oid)[-4:]}",
            "owner":    u.get("display_name") or "",
            "avatar":   md.get("avatar") or (AVATAR + u["avatar"] if u.get("avatar") else None),
            "color":    team_color(oid),
        }
        for pid in (r.get("players") or []):
            out[str(pid)] = tag
    return out


def ecr_data(slug):
    """The page's embedded weekly ranking blob, or None when it is missing."""
    raw = fetch_raw(f"{FP_BASE}{slug}.php")
    if not raw:
        return None
    m = re.search(r"var ecrData\s*=\s*(\{.*?\});", raw, re.S)
    if not m:
        print(f"  ! no ranking payload on {slug}", file=sys.stderr)
        return None
    try:
        return json.loads(m.group(1))
    except Exception as e:
        print(f"  ! bad ranking payload on {slug} ({e})", file=sys.stderr)
        return None


def write(payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "consensus.json")
    tmp  = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)
    return path


def main():
    state       = fetch_json(f"{API}/state/nfl") or {}
    season_type = state.get("season_type", "off")
    in_season   = season_type in ("regular", "post")

    league_id, my_owner = None, None
    try:
        meta = json.load(open(os.path.join(OUT_DIR, "meta.json")))
        league_id = meta.get("current_league_id")
        my_owner  = meta.get("my_owner_id")
    except Exception as e:
        print(f"  ! could not read meta.json ({e})", file=sys.stderr)

    payload = {
        "generated":   datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "scoring":     "ppr",
        "season":      state.get("season"),
        "week":        state.get("week"),
        "season_type": season_type,
        "league_id":   league_id,
        "my_owner_id": my_owner,
        "ready":       False,
        "experts":     None,
        "last_update": None,
        "positions":   [p[1] for p in POSITIONS],
        "owners":      {},
        "rankings":    {},
        "counts":      {},
    }

    if not in_season:
        write(payload)
        print("consensus.json: offseason — no weekly ranks published yet")
        return

    idmap = load_idmap()
    names, sleeper_teams, info = load_sleeper_db()
    owners = load_owners(league_id)

    def resolve(row, pos):
        if pos == "DEF":
            team = (row.get("player_team_id") or "").strip().upper()
            team = TEAM_ALIAS.get(team, team)
            return team if team in sleeper_teams else None
        return idmap.get(str(row.get("player_id"))) or names.get((norm(row.get("player_name")), pos))

    # The FLEX page publishes ranks only — no matchup grade, no projected points —
    # so those two are carried over from the player's own position page. FLEX is
    # last in POSITIONS for exactly this reason: RB/WR/TE are already parsed by the
    # time it is reached. Keyed by pid, so an unresolved row simply keeps its nulls.
    extras = {}
    experts, last_update, counts, unmatched = None, None, {}, []
    for slug, key in POSITIONS:
        doc = ecr_data(slug)
        if not doc:
            counts[key] = 0
            continue
        experts     = experts or doc.get("total_experts")
        last_update = last_update or doc.get("last_updated")
        rows = []
        for row in doc.get("players", []):
            pos = POS_MAP.get(row.get("player_position_id"), row.get("player_position_id"))
            sid = resolve(row, pos)
            if not sid:
                unmatched.append({"name": row.get("player_name"), "pos": pos})
            i = info.get(sid, {}) if sid else {}
            team = (row.get("player_team_id") or i.get("team") or "FA").strip().upper()
            team = TEAM_ALIAS.get(team, team)
            rows.append({
                "rank":     num(row.get("rank_ecr")),
                # null pid = the crosswalk missed him. He still ranks; he just gets no
                # headshot, no player link and no owner tag.
                "pid":      sid,
                "name":     i.get("name") or row.get("player_name"),
                "pos":      pos,
                # "DST1" upstream; the rest of the site says DEF, so say DEF here too.
                "pos_rank": (row.get("pos_rank") or "").replace("DST", "DEF") or None,
                "team":     team,
                "opp":      row.get("player_opponent"),   # "vs. NO" / "@ KC" / "BYE"
                "bye":      num(row.get("player_bye_week")),
                "best":     num(row.get("rank_min")),
                "worst":    num(row.get("rank_max")),
                "avg":      num(row.get("rank_ave")),
                "std":      num(row.get("rank_std")),
                "grade":    row.get("start_sit_grade"),   # "A+" … "F"
                "proj":     num(row.get("r2p_pts")),      # projected PPR points
                "owned":    num(row.get("player_owned_avg")),
                "delta":    num(row.get("player_ecr_delta")),
                "injury":   i.get("injury") or "",
                # Owner id only; the tag itself is written once under "owners". A row
                # is ~40 bytes, an inlined manager ~200, and 292 of these are rostered.
                "own":      (owners.get(str(sid)) or {}).get("owner_id") if sid else None,
            })
            if key == "FLEX":
                rows[-1].update(extras.get(sid) or {})
            elif sid and rows[-1]["grade"]:
                extras[sid] = {"grade": rows[-1]["grade"], "proj": rows[-1]["proj"]}
        rows.sort(key=lambda r: r["rank"] if r["rank"] is not None else 9999)
        cap = CAPS.get(key)
        if cap:
            rows = [r for n, r in enumerate(rows) if n < cap or r["own"]]
        payload["rankings"][key] = rows
        counts[key] = len(rows)
        print(f"  {key}: {len(rows)} ranked")

    payload["owners"]      = {t["owner_id"]: t for t in
                              {t["owner_id"]: t for t in owners.values()}.values()}
    payload["ready"]       = any(counts.values())
    payload["experts"]     = experts
    payload["last_update"] = last_update
    payload["counts"]      = dict(counts, unmatched=len(unmatched), owned=sum(
        1 for rs in payload["rankings"].values() for r in rs if r.get("own")))

    path = write(payload)
    total = sum(counts.values())
    print(f"consensus.json [week {payload['week']}]: {total} ranked rows across "
          f"{len(payload['rankings'])} positions, {len(unmatched)} unresolved -> {path}")
    if unmatched:
        print("  unresolved sample:", ", ".join(f"{u['name']}({u['pos']})" for u in unmatched[:8]))


if __name__ == "__main__":
    main()
