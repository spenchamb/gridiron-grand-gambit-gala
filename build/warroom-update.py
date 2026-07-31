#!/usr/bin/env python3
"""
warroom-update.py  —  blended consensus board for the Draft War Room (scbl.ink/warroom).

Deliberately standalone. The War Room is detached from the GGGG fantasy section and
from scbl.ink's football pages: it has its own builder, its own data directory and
its own page, so nothing about draft day depends on the league site's schedule.

Blends FIVE independent consensus sources into one board rather than trusting any
single ranking:

  expert  fp        FantasyPros ECR      ~70 experts, the standard consensus
  expert  espn      ESPN PPR draft rank  a genuinely separate expert set
  market  fcalc     FantasyCalc          redraft trade values (crowd valuation)
  market  ffc_adp   FantasyFootballCalc  ADP over thousands of real drafts
  market  espn_adp  ESPN ADP             ADP over a very large league sample

Each source is reduced to a 1..N ordering and the blend is the MEDIAN of whatever
sources have that player. Median, not mean, on purpose: when one source has a wild
outlier (an injury a site hasn't priced in, a rookie one set of experts loves) the
median ignores it instead of letting it drag the player up or down. Component ranks
are kept per player so the page can show its work.

Everything is keyed to Sleeper player ids so the live draft feed can subtract picks
directly. FantasyCalc publishes sleeperId natively; FantasyPros goes through the
DynastyProcess crosswalk; ESPN and FFC resolve on normalized name+position.

Writes <OUT_DIR>/board.json.  Override paths for local runs:
  SC_WARROOM_OUT=./www/warroom/data python3 build/warroom-update.py
"""
import urllib.request, urllib.error, json, re, csv, io, os, sys, time, unicodedata, datetime, statistics

API      = "https://api.sleeper.app/v1"
OUT_DIR  = os.environ.get("SC_WARROOM_OUT", "/mnt/cache/appdata/www-data/warroom/data")
UA       = {"User-Agent": "scbeelink-warroom/1.0"}

FP_BASE   = "https://www.fantasypros.com/nfl/rankings/"
IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
FFC_URL   = "https://fantasyfootballcalculator.com/api/v1/adp/ppr"
FCALC_URL = "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&ppr=1"
ESPN_URL  = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}"
             "/segments/0/leaguedefaults/3?view=kona_player_info")
ESPN_DEPTH = 400

FP_OVERALL   = "ppr-cheatsheets"
FP_POS_SLUGS = {"QB": "qb-cheatsheets",     "RB": "ppr-rb-cheatsheets",
                "WR": "ppr-wr-cheatsheets", "TE": "ppr-te-cheatsheets",
                "K":  "k-cheatsheets",      "DEF": "dst-cheatsheets"}

POS_MAP    = {"DST": "DEF", "PK": "K"}
TEAM_ALIAS = {"JAC": "JAX", "WSH": "WAS", "LA": "LAR"}
ESPN_POS   = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

# Order matters only for display; the blend itself is unweighted.
SOURCES = ["fp", "espn", "fcalc", "ffc_adp", "espn_adp"]


def fetch_raw(url, tries=3, backoff=1.5, headers=None):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or UA)
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


def fetch_json(url, headers=None):
    raw = fetch_raw(url, headers=headers)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception as e:
        print(f"  ! bad json from {url} ({e})", file=sys.stderr)
        return None


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z ]", "", s.lower())
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def load_idmap():
    raw = fetch_raw(IDMAP_URL)
    m = {}
    if not raw:
        print("  ! no DynastyProcess id map", file=sys.stderr)
        return m
    for row in csv.DictReader(io.StringIO(raw)):
        fp, sl = (row.get("fantasypros_id") or "").strip(), (row.get("sleeper_id") or "").strip()
        if fp and sl:
            m[fp] = sl
    return m


def load_sleeper_db():
    """(name_idx, def_pids, info) — name_idx maps (norm_name, pos) -> sleeper pid."""
    raw = fetch_json(f"{API}/players/nfl") or {}
    idx, teams, info = {}, set(), {}
    for pid, p in raw.items():
        if not isinstance(p, dict):
            continue
        pos = p.get("position")
        if pos == "DEF":
            teams.add(pid)
            nm = norm(p.get("full_name") or p.get("team") or pid)
            name = (p.get("full_name") or p.get("team") or pid) + " D/ST"
            team = p.get("team") or pid
        else:
            nm = norm(f"{p.get('first_name','')} {p.get('last_name','')}")
            name = f"{p.get('first_name','')} {p.get('last_name','')}".strip() or pid
            team = p.get("team") or "FA"
        if nm:
            idx.setdefault((nm, pos), pid)
        info[pid] = {"name": name, "pos": pos, "team": team,
                     "bye": None, "injury": (p.get("injury_status") or "").strip()}
    return idx, teams, info


def by_name(names, nm, pos):
    """Name+position lookup, with a DEF fallback since site naming varies wildly
    ('Seattle Defense', 'Seahawks D/ST', 'SEA')."""
    return names.get((nm, pos))


def resolve_def(team, sleeper_teams):
    team = TEAM_ALIAS.get((team or "").strip().upper(), (team or "").strip().upper())
    return team if team in sleeper_teams else None


# ---------------------------------------------------------------- sources ----
def ecr_rows(slug):
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


def src_fantasypros(idmap, names, sleeper_teams, info):
    """Overall ECR + positional tiers. Returns (rank_by_pid, extra_by_pid)."""
    ranks, extra = {}, {}
    for row in ecr_rows(FP_OVERALL):
        pos = POS_MAP.get(row.get("player_position_id"), row.get("player_position_id"))
        sid = (resolve_def(row.get("player_team_id"), sleeper_teams) if pos == "DEF"
               else idmap.get(str(row.get("player_id"))) or by_name(names, norm(row.get("player_name")), pos))
        if not sid:
            continue
        try:
            ranks[sid] = float(row.get("rank_ecr"))
        except (TypeError, ValueError):
            continue
        bye = row.get("player_bye_week")
        extra[sid] = {"pos": pos,
                      "bye": int(bye) if str(bye).isdigit() else None,
                      "team": TEAM_ALIAS.get(row.get("player_team_id"), row.get("player_team_id")),
                      "std": _f(row.get("rank_std")),
                      "best": _f(row.get("rank_min")), "worst": _f(row.get("rank_max"))}
    # Positional pages carry the positional tier, which the overall page can't
    # (its `tier` is cross-position, so "RB tier 3" doesn't exist there).
    for pos, slug in FP_POS_SLUGS.items():
        for row in ecr_rows(slug):
            sid = (resolve_def(row.get("player_team_id"), sleeper_teams) if pos == "DEF"
                   else idmap.get(str(row.get("player_id"))) or by_name(names, norm(row.get("player_name")), pos))
            if not sid:
                continue
            e = extra.setdefault(sid, {"pos": pos, "bye": None, "team": None})
            e["tier"]  = _f(row.get("tier"))
            e["prank"] = _f(row.get("rank_ecr"))
    return ranks, extra


def src_espn(season, names, sleeper_teams):
    """ESPN's own PPR draft rank and ESPN ADP — two separate signals."""
    hdr = dict(UA)
    hdr["x-fantasy-filter"] = json.dumps(
        {"players": {"limit": ESPN_DEPTH,
                     "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "PPR"}}})
    doc = fetch_json(ESPN_URL.format(season=season), headers=hdr)
    ranks, adps, proj = {}, {}, {}
    if not doc:
        print("  ! no ESPN data", file=sys.stderr)
        return ranks, adps, proj
    for p in doc.get("players") or []:
        pl = p.get("player") or {}
        pos = ESPN_POS.get(pl.get("defaultPositionId"))
        if not pos:
            continue
        sid = (resolve_def(_espn_team(pl), sleeper_teams) if pos == "DEF"
               else by_name(names, norm(pl.get("fullName")), pos))
        if not sid:
            continue
        r = ((pl.get("draftRanksByRankType") or {}).get("PPR") or {}).get("rank")
        if r:
            ranks[sid] = float(r)
        a = (pl.get("ownership") or {}).get("averageDraftPosition")
        if a and a > 0:
            adps[sid] = float(a)
        rt = ((p.get("ratings") or {}).get("0") or {}).get("totalRating")
        if rt:
            proj[sid] = round(float(rt), 1)
    return ranks, adps, proj


def _espn_team(pl):
    # ESPN D/ST names read "Seahawks D/ST"; the team abbrev isn't in this view,
    # so fall back to parsing the name against Sleeper's team codes upstream.
    nm = (pl.get("fullName") or "").replace(" D/ST", "").strip()
    return ESPN_DST_TEAM.get(nm, nm)


ESPN_DST_TEAM = {
    "49ers": "SF", "Bears": "CHI", "Bengals": "CIN", "Bills": "BUF", "Broncos": "DEN",
    "Browns": "CLE", "Buccaneers": "TB", "Cardinals": "ARI", "Chargers": "LAC",
    "Chiefs": "KC", "Colts": "IND", "Commanders": "WAS", "Cowboys": "DAL",
    "Dolphins": "MIA", "Eagles": "PHI", "Falcons": "ATL", "Giants": "NYG",
    "Jaguars": "JAX", "Jets": "NYJ", "Lions": "DET", "Packers": "GB", "Panthers": "CAR",
    "Patriots": "NE", "Raiders": "LV", "Rams": "LAR", "Ravens": "BAL", "Saints": "NO",
    "Seahawks": "SEA", "Steelers": "PIT", "Texans": "HOU", "Titans": "TEN", "Vikings": "MIN",
}


def src_fantasycalc():
    """Redraft trade values. Publishes sleeperId, so no name matching needed.

    FantasyCalc's own `maybeTier` is deliberately NOT returned here. It's a
    cross-position, trade-value tier on FantasyCalc's own scale — nothing to do
    with FantasyPros' per-position ECR tier, which is the only `tier` the board
    displays. A caller used to fall back to this when FantasyPros had none,
    which silently mixed two unrelated tier scales into one field and was a
    real source of the "tiers look out of order" reports."""
    doc = fetch_json(FCALC_URL)
    ranks = {}
    if not doc:
        print("  ! no FantasyCalc data", file=sys.stderr)
        return ranks
    for row in doc:
        sid = ((row.get("player") or {}).get("sleeperId") or "").strip()
        r = row.get("overallRank")
        if sid and r:
            ranks[sid] = float(r)
    return ranks


def src_ffc(season, teams, names, sleeper_teams):
    doc = fetch_json(f"{FFC_URL}?teams={teams}&year={season}")
    adps, meta = {}, {}
    if not doc:
        print("  ! no FFC data", file=sys.stderr)
        return adps, meta
    for row in doc.get("players") or []:
        pos = POS_MAP.get(row.get("position"), row.get("position"))
        sid = (resolve_def(row.get("team"), sleeper_teams) if pos == "DEF"
               else by_name(names, norm(row.get("name")), pos))
        if sid and row.get("adp"):
            adps[sid] = float(row["adp"])
    m = doc.get("meta") or {}
    meta = {"total_drafts": m.get("total_drafts"), "start_date": m.get("start_date"),
            "end_date": m.get("end_date")}
    return adps, meta


def _f(v):
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 2)
    except (TypeError, ValueError):
        return None


def to_rank(d):
    """Turn any numeric signal (ADP, value order) into a dense 1..N ranking."""
    out = {}
    for i, (pid, _v) in enumerate(sorted(d.items(), key=lambda kv: kv[1]), start=1):
        out[pid] = float(i)
    return out


def main():
    state = fetch_json(f"{API}/state/nfl") or {}
    season = state.get("season") or str(datetime.date.today().year)

    idmap = load_idmap()
    names, sleeper_teams, info = load_sleeper_db()

    fp_ranks, fp_extra = src_fantasypros(idmap, names, sleeper_teams, info)
    espn_ranks, espn_adps, espn_proj = src_espn(season, names, sleeper_teams)
    fcalc_ranks = src_fantasycalc()
    ffc_adps, ffc_meta = src_ffc(season, 12, names, sleeper_teams)

    # ADP and trade value aren't ranks; convert to orderings before blending so
    # every source contributes on the same 1..N scale.
    src_ranks = {
        "fp":       fp_ranks,
        "espn":     espn_ranks,
        "fcalc":    fcalc_ranks,
        "ffc_adp":  to_rank(ffc_adps),
        "espn_adp": to_rank(espn_adps),
    }
    counts = {k: len(v) for k, v in src_ranks.items()}
    print("  source depth:", counts)

    every_pid = set()
    for v in src_ranks.values():
        every_pid |= set(v)

    rows = []
    for pid in every_pid:
        comps = {k: src_ranks[k].get(pid) for k in SOURCES}
        have = [v for v in comps.values() if v is not None]
        # One source alone isn't a consensus — it's just that site's opinion, and
        # letting singletons in would fill the board with players nobody else ranks.
        if len(have) < 2:
            continue
        meta_i = info.get(pid, {})
        ex = fp_extra.get(pid, {})
        pos = ex.get("pos") or meta_i.get("pos")
        if pos not in ("QB", "RB", "WR", "TE", "K", "DEF"):
            continue
        blend = statistics.median(have)
        rows.append({
            "pid":   pid,
            "name":  meta_i.get("name") or pid,
            "pos":   pos,
            "team":  ex.get("team") or meta_i.get("team") or "FA",
            "bye":   ex.get("bye"),
            "inj":   meta_i.get("injury") or "",
            "blend": round(blend, 1),
            "n":     len(have),
            # How much the sources disagree. A tight spread means every site sees
            # the same player; a wide one is where your own read is worth most.
            "spread": round(max(have) - min(have), 1),
            "srcs":  {k: (round(v, 1) if v is not None else None) for k, v in comps.items()},
            "tier":  ex.get("tier"),   # FantasyPros positional tier only — see src_fantasycalc
            "prank": ex.get("prank"),
            "std":   ex.get("std"),
            "proj":  espn_proj.get(pid),
            "adp":   round(ffc_adps[pid], 1) if pid in ffc_adps else (
                     round(espn_adps[pid], 1) if pid in espn_adps else None),
        })

    rows.sort(key=lambda r: r["blend"])
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    # Positional rank off the blended board, so it stays consistent with `rank`.
    pc = {}
    for r in rows:
        pc[r["pos"]] = pc.get(r["pos"], 0) + 1
        r["posrank"] = pc[r["pos"]]
        # Value: where the market drafts him vs where the blend ranks him.
        r["value"] = round(r["adp"] - r["rank"], 1) if r["adp"] is not None else None

    payload = {
        "generated": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "season":    season,
        "scoring":   "ppr",
        "method":    "median of per-source rankings",
        "sources": {
            "fp":       {"label": "FantasyPros ECR", "kind": "expert", "n": counts["fp"]},
            "espn":     {"label": "ESPN rank",       "kind": "expert", "n": counts["espn"]},
            "fcalc":    {"label": "FantasyCalc",     "kind": "market", "n": counts["fcalc"]},
            "ffc_adp":  {"label": "FFC ADP",         "kind": "market", "n": counts["ffc_adp"],
                         **(ffc_meta or {})},
            "espn_adp": {"label": "ESPN ADP",        "kind": "market", "n": counts["espn_adp"]},
        },
        "counts": {"players": len(rows),
                   "all_five": sum(1 for r in rows if r["n"] == 5),
                   "tiered":   sum(1 for r in rows if r.get("tier"))},
        "players": rows,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "board.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)
    print(f"board.json: {len(rows)} players "
          f"({payload['counts']['all_five']} in all 5 sources, "
          f"{payload['counts']['tiered']} tiered) -> {path}")


if __name__ == "__main__":
    main()
