#!/usr/bin/env python3
"""
ffpros-update.py  —  FantasyPros Expert Consensus Rankings (ECR) producer for the GGGG site.

Scrapes FantasyPros' embedded `ecrData` JSON (the same source the R `ffpros` package uses),
resolves each FantasyPros player_id to a Sleeper player_id via the maintained DynastyProcess
id crosswalk (fantasypros_id <-> sleeper_id) with a normalized name+position fallback, and
writes a slim display-ready sleeper/data/ecr.json keyed by Sleeper pid.

League is full PPR, so PPR rankings are used. Offseason -> draft cheatsheets; in-season
(nfl state season_type regular/post) -> rest-of-season (ROS) rankings, chosen automatically.

Private-facing: this file is NOT linked from the sitemap and republishes FantasyPros' ECR
only for the league's own tooling.
"""
import urllib.request, urllib.error, json, re, csv, io, os, sys, time, unicodedata, datetime

API      = "https://api.sleeper.app/v1"
OUT_DIR  = "/mnt/cache/appdata/www-data/sleeper/data"
UA       = {"User-Agent": "scbeelink-ffpros/1.0"}
FP_BASE  = "https://www.fantasypros.com/nfl/rankings/"
IDMAP_URL= "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"

# Overall cross-position PPR ranking page. rank_ecr is GLOBAL; pos_rank is e.g. "WR1".
# Offseason -> draft cheatsheet; in-season -> rest-of-season overall.
DRAFT_SLUG = "ppr-cheatsheets"
ROS_SLUG   = "ros-ppr-overall"

# FantasyPros position code -> Sleeper position.
POS_MAP = {"DST": "DEF"}

# FantasyPros team code -> Sleeper DEF pid, where they differ.
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


def load_idmap():
    """fantasypros_id -> sleeper_id from the DynastyProcess crosswalk."""
    raw = fetch_raw(IDMAP_URL)
    m = {}
    if not raw:
        print("  ! could not load DynastyProcess id map", file=sys.stderr)
        return m
    for row in csv.DictReader(io.StringIO(raw)):
        fp = (row.get("fantasypros_id") or "").strip()
        sl = (row.get("sleeper_id") or "").strip()
        if fp and sl:
            m[fp] = sl
    return m


def load_sleeper_db():
    """Returns (name_idx, def_pids, info) where
       name_idx: (normalized_name, position) -> sleeper_id (name fallback)
       def_pids: set of DEF pids (team codes)
       info:     sleeper_id -> {name, pos, team, injury} for display."""
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


def rostered_pids(league_id):
    """Set of sleeper pids currently on a roster in the league."""
    rosters = fetch_json(f"{API}/league/{league_id}/rosters") or []
    out = set()
    for r in rosters:
        for pid in (r.get("players") or []):
            out.add(str(pid))
    return out


def ecr_data(slug):
    raw = fetch_raw(f"{FP_BASE}{slug}.php")
    if not raw:
        return []
    m = re.search(r"var ecrData\s*=\s*(\{.*?\});", raw, re.S)
    if not m:
        return []
    try:
        return json.loads(m.group(1)).get("players", [])
    except Exception:
        return []


def num(v):
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 2)
    except (TypeError, ValueError):
        return None


def main():
    state = fetch_json(f"{API}/state/nfl") or {}
    season_type = state.get("season_type", "off")
    in_season = season_type in ("regular", "post")
    slug = ROS_SLUG if in_season else DRAFT_SLUG
    mode = "ros" if in_season else "draft"

    idmap = load_idmap()
    names, sleeper_teams, info = load_sleeper_db()

    players = {}         # sleeper_pid -> ecr record
    unmatched = []       # FP rows that resolved to no sleeper id (monitoring)
    seen_fp = 0

    def resolve(row, pos):
        # Defenses: Sleeper's pid IS the team abbreviation (e.g. "PIT").
        if pos == "DEF":
            team = (row.get("player_team_id") or "").strip().upper()
            team = TEAM_ALIAS.get(team, team)
            if team and team in sleeper_teams:
                return team, "team"
            return None, None
        sid = idmap.get(str(row.get("player_id")))
        if sid:
            return sid, "idmap"
        sid = names.get((norm(row.get("player_name")), pos))
        if sid:
            return sid, "name"
        return None, None

    board = []   # full ranked list with display fields (for the public big board)
    via = {"idmap": 0, "name": 0, "team": 0}
    for row in ecr_data(slug):
        seen_fp += 1
        pos = POS_MAP.get(row.get("player_position_id"), row.get("player_position_id"))
        sid, how = resolve(row, pos)
        if not sid:
            unmatched.append({"fp_id": row.get("player_id"),
                              "name": row.get("player_name"),
                              "pos": pos, "team": row.get("player_team_id")})
            continue
        via[how] += 1
        ecr = num(row.get("rank_ecr"))
        players[sid] = {
            "pos":       pos,
            "ecr":       ecr,                         # GLOBAL cross-position rank
            "pos_rank":  row.get("pos_rank"),         # e.g. "WR1" (string)
            "std":       num(row.get("rank_std")),
            "best":      num(row.get("rank_min")),
            "worst":     num(row.get("rank_max")),
            "owned":     num(row.get("player_owned_avg")),
            "delta":     num(row.get("player_ecr_delta")),
        }
        info_i = info.get(sid, {})
        team = (row.get("player_team_id") or info_i.get("team") or "FA")
        team = {"JAC": "JAX", "WSH": "WAS"}.get(team, team)
        board.append({
            "pid":      sid,
            "name":     info_i.get("name") or row.get("player_name"),
            "pos":      pos,
            "team":     team,
            "bye":      num(row.get("player_bye_week")),
            "ecr":      ecr,
            "pos_rank": row.get("pos_rank"),
            "tier":     num(row.get("tier")),
            "owned":    num(row.get("player_owned_avg")),
            "std":      num(row.get("rank_std")),
        })
    board.sort(key=lambda r: (r["ecr"] if r["ecr"] is not None else 9999))

    # ---- ECR-ranked best-available (unrostered) by position -----------------
    # Read the sleeper build's meta.json for the current league, then exclude
    # everyone already on a roster. Includes players who didn't score last year.
    available = {}
    league_id = None
    try:
        meta = json.load(open(os.path.join(OUT_DIR, "meta.json")))
        league_id = meta.get("current_league_id")
    except Exception as e:
        print(f"  ! could not read meta.json for availability ({e})", file=sys.stderr)
    if league_id:
        onroster = rostered_pids(league_id)
        POS_CAP, ALL_CAP = 40, 60
        rows = []
        for sid, rec in players.items():
            if sid in onroster or rec.get("ecr") is None:
                continue
            meta_i = info.get(sid, {})
            rows.append({
                "pid": sid, "name": meta_i.get("name", sid),
                "pos": rec["pos"], "team": meta_i.get("team", "FA"),
                "injury": meta_i.get("injury", ""),
                "ecr": rec["ecr"], "pos_rank": rec.get("pos_rank"),
                "owned": rec.get("owned"),
            })
        rows.sort(key=lambda r: r["ecr"])
        by_pos = {}
        for r in rows:
            by_pos.setdefault(r["pos"], []).append(r)
        available = {p: v[:POS_CAP] for p, v in by_pos.items()}
        available["ALL"] = rows[:ALL_CAP]
        print(f"  available (unrostered, ECR-ranked): {len(rows)} players, "
              f"top {len(available['ALL'])} overall")

    payload = {
        "generated":   datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "source":      "Expert Consensus",
        "scoring":     "ppr",
        "mode":        mode,                      # "draft" (offseason) or "ros" (in-season)
        "season":      state.get("season"),
        "week":        state.get("week"),
        "season_type": season_type,
        "league_id":   league_id,
        "counts":      {"fp_rows": seen_fp, "resolved": len(players),
                        "via_idmap": via["idmap"], "via_name": via["name"], "via_team": via["team"],
                        "unmatched": len(unmatched), "available": sum(len(v) for k,v in available.items() if k!="ALL")},
        "players":     players,
        "board":       board,
        "available":   available,
        "unmatched":   unmatched,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "ecr.json")
    tmp  = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)
    print(f"ecr.json [{mode}]: {len(players)} players resolved "
          f"(idmap={via['idmap']} name={via['name']}), {len(unmatched)} unmatched, "
          f"{seen_fp} FP rows -> {path}")
    if unmatched:
        print("  unmatched sample:", ", ".join(f"{u['name']}({u['pos']})" for u in unmatched[:8]))


if __name__ == "__main__":
    main()
