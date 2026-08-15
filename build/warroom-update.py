#!/usr/bin/env python3
"""
warroom-update.py  —  blended consensus board for the Draft War Room (scbl.ink/warroom).

Deliberately standalone. The War Room is detached from the GGGG fantasy section and
from scbl.ink's football pages: it has its own builder, its own data directory and
its own page, so nothing about draft day depends on the league site's schedule.

Blends SEVEN independent consensus sources into one board rather than trusting any
single ranking:

  expert  fp        FantasyPros ECR      ~70 experts, the standard consensus
  expert  espn      ESPN PPR draft rank  a genuinely separate expert set
  expert  fd        FirstDown Studio     Vegas player-prop-derived flex rank (RB/WR/TE only)
  market  fcalc     FantasyCalc          redraft trade values (crowd valuation)
  market  ffc_adp   FantasyFootballCalc  ADP over thousands of real drafts
  market  espn_adp  ESPN ADP             ADP over a very large league sample
  market  sleeper_adp  Sleeper ADP       ADP of the platform the draft is actually held on

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
FD_URL    = "https://www.firstdown.studio/season-rankings/flex"
ESPN_URL  = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}"
             "/segments/0/leaguedefaults/3?view=kona_player_info")
ESPN_DEPTH = 400
# UNDOCUMENTED Sleeper endpoint (note: /projections, not the /v1 API). It is the
# ADP of the platform the draft actually happens on, which no other source here
# captures — FFC and ESPN measure their own populations, not this draft room.
# Treated as strictly optional everywhere: if Sleeper changes or drops it, the
# board silently falls back to the other five sources.
SLEEPER_PROJ_URL = ("https://api.sleeper.app/projections/nfl/{season}"
                    "?season_type=regular&position[]={pos}&order_by=pts_ppr")

FP_OVERALL   = "ppr-cheatsheets"
FP_POS_SLUGS = {"QB": "qb-cheatsheets",     "RB": "ppr-rb-cheatsheets",
                "WR": "ppr-wr-cheatsheets", "TE": "ppr-te-cheatsheets",
                "K":  "k-cheatsheets",      "DEF": "dst-cheatsheets"}

POS_MAP    = {"DST": "DEF", "PK": "K"}
TEAM_ALIAS = {"JAC": "JAX", "WSH": "WAS", "LA": "LAR"}
ESPN_POS   = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

# Order matters only for display; the blend itself is unweighted.
SOURCES = ["fp", "espn", "fd", "fcalc", "ffc_adp", "espn_adp", "sleeper_adp"]


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
        # Depth chart: "RB2" etc. Sleeper maintains these continuously and we're
        # already downloading the blob — the data was simply being discarded.
        dcp, dco = p.get("depth_chart_position"), p.get("depth_chart_order")
        info[pid] = {"name": name, "pos": pos, "team": team,
                     "bye": None, "injury": (p.get("injury_status") or "").strip(),
                     "age": p.get("age"), "exp": p.get("years_exp"),
                     "dc": f"{dcp}{dco}" if dcp and dco else None}
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


FD_OBJ_RE = re.compile(
    r'\{\\"canonicalPlayerId\\":\\"[a-f0-9-]+\\".*?\\"adpPosRank\\":\{.*?\}\}\}'
)


def src_firstdown():
    """FirstDown Studio's Vegas-props-derived flex rank (redraft, RB/WR/TE
    only — the page has no dynasty/superflex view to pick, so this is the only
    reading of it). Per-player objects are embedded in the page's Next.js RSC
    payload as an escaped JSON blob that already carries the Sleeper id, so —
    unlike every other source here — no name/team matching is needed. Ranked
    by projected PPR points, the field that scoring format actually selects.

    Fully optional: any failure returns {} and the blend just proceeds with
    the remaining six sources."""
    raw = fetch_raw(FD_URL)
    if not raw:
        print("  ! no FirstDown Studio data", file=sys.stderr)
        return {}
    seen, pts_by_pid = set(), {}
    for blob in FD_OBJ_RE.findall(raw):
        try:
            o = json.loads(blob.replace('\\"', '"').replace("\\\\", "\\"))
        except Exception:
            continue
        sid = o.get("sleeperId")
        pts = (o.get("fantasyPointsByScoring") or {}).get("ppr")
        if not sid or sid in seen or pts is None:
            continue
        seen.add(sid)
        pts_by_pid[sid] = pts
    return to_rank({pid: -pts for pid, pts in pts_by_pid.items()})


def src_ffc(season, teams, names, sleeper_teams):
    """Returns (adps, sds, meta). stdev is the input the availability-probability
    model needs — how tightly the market agrees on when a player goes."""
    doc = fetch_json(f"{FFC_URL}?teams={teams}&year={season}")
    adps, sds, meta = {}, {}, {}
    if not doc:
        print("  ! no FFC data", file=sys.stderr)
        return adps, sds, meta
    for row in doc.get("players") or []:
        pos = POS_MAP.get(row.get("position"), row.get("position"))
        sid = (resolve_def(row.get("team"), sleeper_teams) if pos == "DEF"
               else by_name(names, norm(row.get("name")), pos))
        if sid and row.get("adp"):
            adps[sid] = float(row["adp"])
            if row.get("stdev"):
                sds[sid] = float(row["stdev"])
    m = doc.get("meta") or {}
    meta = {"total_drafts": m.get("total_drafts"), "start_date": m.get("start_date"),
            "end_date": m.get("end_date")}
    return adps, sds, meta


def src_sleeper_adp(season):
    """Sleeper's own PPR ADP + season projections, keyed natively by Sleeper id.

    Returns (adps, projs). This is the only source that measures the platform
    the draft is actually held on — the others describe their own populations.

    Sleeper reports 999.0 as "no ADP" rather than omitting the field, which
    would sort those players to the very bottom of a rank ordering instead of
    excluding them; filtered explicitly. Entirely optional: any failure just
    yields empty dicts and the blend carries on with the remaining sources."""
    adps, projs = {}, {}
    for pos in ("QB", "RB", "WR", "TE", "K", "DEF"):
        rows = fetch_json(SLEEPER_PROJ_URL.format(season=season, pos=pos))
        if not rows:
            print(f"  ! no Sleeper projections for {pos}", file=sys.stderr)
            continue
        for r in rows:
            pid = str(r.get("player_id") or "")
            st = r.get("stats") or {}
            if not pid:
                continue
            a = st.get("adp_ppr")
            if a is not None and a < 999:
                adps[pid] = float(a)
            p = st.get("pts_ppr")
            if p:
                projs[pid] = round(float(p), 1)
    return adps, projs


def src_trending():
    """Sleeper-wide 24h adds. A hype/news spike shows up here hours before the
    ranking sites re-publish — it's the 'consensus hasn't caught up yet' flag."""
    rows = fetch_json(f"{API}/players/nfl/trending/add?lookback_hours=24&limit=60") or []
    return {str(r["player_id"]): int(r["count"]) for r in rows
            if r.get("player_id") and r.get("count")}


# ESPN scoreboard team codes that differ from Sleeper's.
ESPN_TEAM_ALIAS = {"WSH": "WAS"}


# ---- GGGG league-scoring DEF adjustment ----------------------------------
# Every source on this board is built for STOCK Sleeper PPR. GGGG's offense is
# stock PPR (only pass_int -2 vs -1, worth ~10 pts/season and empirically worth
# nothing in rank terms), but its DEF scoring is heavily rewritten:
#
#   - points-allowed upside halved (shutout 5 not 10, 1-6 -> 4 not 7)
#     while the downside tiers are left untouched
#   - yards-allowed tiers ADDED, +5 (<100) down to -7 (550+)
#   - 3-and-outs, 4th-down stops and TFLs all score
#
# Scored against real prior-season stats those rules move DEF rank order less
# than they look like they should (2025: Spearman 0.94, mean shift 2.5 spots) —
# the new categories are collinear with the one they replaced, since good
# defenses allow few points AND few yards AND get more stops. What they really
# do is WIDEN the spread (DEF1-over-DEF12 +16%, DEF3-over-DEF12 +41%) and
# reshuffle the streaming tier while leaving the elite tier alone.
#
# So this emits a per-team rank shift only — how a defense's profile scores
# under GGGG's rules vs stock — and the page permutes DEF slots by it. It does
# NOT restate the board's rank scale, because the sources it's built from have
# no opinion about GGGG's rules in the first place.
GGGG_NAME_MATCH = "gridiron grand gambit"
GGGG_USER       = "footspencerball"

# Stock Sleeper PPR defense scoring — the baseline every consensus source models.
STOCK_DEF = {
    "sack": 1.0, "int": 2.0, "fum_rec": 2.0, "ff": 1.0, "safe": 2.0,
    "def_td": 6.0, "st_td": 6.0, "def_st_td": 6.0, "blk_kick": 2.0,
    "st_ff": 1.0, "st_fum_rec": 1.0, "def_st_ff": 1.0, "def_st_fum_rec": 1.0,
    "fum_rec_td": 6.0,
    "pts_allow_0": 10.0, "pts_allow_1_6": 7.0, "pts_allow_7_13": 4.0,
    "pts_allow_14_20": 1.0, "pts_allow_21_27": 0.0,
    "pts_allow_28_34": -1.0, "pts_allow_35p": -4.0,
}

# Only categories a DEF unit can actually accrue — keeps offensive keys that
# share a name (e.g. `ff`) from leaking in if Sleeper ever reshapes the payload.
def _score(stat, rules):
    return sum((rules.get(k) or 0) * v
               for k, v in stat.items() if isinstance(v, (int, float)))


def gggg_def_shift(season):
    """{team: shift} — DEF rank movement under GGGG scoring vs stock PPR.

    Positive = the defense is better in GGGG than consensus (stock) implies.

    Scoring rules are read LIVE off the league rather than hardcoded, so a
    commissioner edit shows up on the next build instead of silently rotting.
    The prior completed season supplies the stats; team defenses persist
    year-over-year so the profile carries even though the personnel shifts.

    Fully optional: any failure returns {} and the page just never offers the
    adjustment rather than showing a wrong one.
    """
    try:
        user = fetch_json(f"{API}/user/{GGGG_USER}") or {}
        uid = user.get("user_id")
        if not uid:
            return {}
        leagues = fetch_json(f"{API}/user/{uid}/leagues/nfl/{season}") or []
        lg = next((L for L in leagues
                   if GGGG_NAME_MATCH in (L.get("name") or "").lower()), None)
        if not lg:
            return {}
        rules = lg.get("scoring_settings") or {}
        if not rules:
            return {}

        stats = fetch_json(f"{API}/stats/nfl/regular/{int(season) - 1}") or {}
        # DEF units are keyed by bare team abbreviation in the stats feed.
        teams = [t for t in stats
                 if len(t) <= 3 and t.isalpha() and t.isupper()
                 and isinstance(stats[t], dict)
                 and "pts_allow" in stats[t]]
        if len(teams) < 24:          # a partial feed would produce garbage ranks
            return {}

        gg = sorted(teams, key=lambda t: -_score(stats[t], rules))
        st = sorted(teams, key=lambda t: -_score(stats[t], STOCK_DEF))
        gr = {t: i + 1 for i, t in enumerate(gg)}
        sr = {t: i + 1 for i, t in enumerate(st)}
        return {t: sr[t] - gr[t] for t in teams if sr[t] != gr[t]}
    except Exception as e:
        print(f"  ! gggg def adjustment unavailable: {e}", file=sys.stderr)
        return {}


def src_playoff_sos(season, weeks=(15, 16, 17)):
    """{team: [(week, 'vs OPP'|'@ OPP'), ...]} from the real schedule.

    The difficulty score itself is computed later against OUR blended DEF
    ranking — deliberately no extra 'defense strength' source. Preseason
    defensive projections are all noise anyway; using our own board keeps the
    proxy self-consistent, and the page labels it as the rough signal it is."""
    opps = {}
    for w in weeks:
        doc = fetch_json("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
                         f"scoreboard?seasontype=2&week={w}&dates={season}", headers=UA)
        for ev in (doc or {}).get("events") or []:
            try:
                comp = ev["competitions"][0]["competitors"]
                home = next(c for c in comp if c["homeAway"] == "home")
                away = next(c for c in comp if c["homeAway"] == "away")
                h = ESPN_TEAM_ALIAS.get(home["team"]["abbreviation"], home["team"]["abbreviation"])
                a = ESPN_TEAM_ALIAS.get(away["team"]["abbreviation"], away["team"]["abbreviation"])
                opps.setdefault(h, []).append((w, f"vs {a}"))
                opps.setdefault(a, []).append((w, f"@ {h}"))
            except Exception:
                continue
    return opps


def _blend_proj(*vals):
    """Mean of whatever projection sources have this player; None if none do."""
    got = [v for v in vals if v is not None]
    return round(sum(got) / len(got), 1) if got else None


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


HIST_FILE      = "history.json"
HIST_KEEP_DAYS = 5      # a few days of headroom around the 24h comparison
HIST_TARGET_H  = 24     # "last day" — the age we try to compare against
HIST_MIN_H     = 1      # ignore snapshots too recent to show real movement
HIST_MAX_H     = 60     # beyond this it isn't "recent movement" any more


def _parse_iso(s):
    try:
        return datetime.datetime.fromisoformat(s)
    except Exception:
        return None


def rank_deltas(rows, now):
    """Rank movement since roughly 24h ago, from a rolling snapshot history.

    board.json is only ever a current snapshot, so movement has to be derived
    from our own history — no source hands us a blended-consensus delta. Each
    run appends {timestamp: {pid: rank}} and we diff against whichever stored
    snapshot sits closest to 24h old.

    Positive delta = moved UP the board (rank 50 -> 30 is +20), which is the
    direction people expect from "riser".

    Returns (from_iso, hours_elapsed) and mutates rows with `d1`. On the very
    first run there's nothing to compare against and every `d1` is None — the
    page hides the section until real history exists.
    """
    path = os.path.join(OUT_DIR, HIST_FILE)
    try:
        with open(path) as f:
            snaps = (json.load(f) or {}).get("snapshots") or []
    except Exception:
        snaps = []

    # Pick the snapshot nearest HIST_TARGET_H old, within a sane window.
    best, best_gap, best_age = None, None, None
    for s in snaps:
        t = _parse_iso(s.get("t") or "")
        if not t:
            continue
        age_h = (now - t).total_seconds() / 3600.0
        if age_h < HIST_MIN_H or age_h > HIST_MAX_H:
            continue
        gap = abs(age_h - HIST_TARGET_H)
        if best_gap is None or gap < best_gap:
            best, best_gap, best_age = s, gap, age_h

    from_iso, hours = None, None
    if best:
        prev = best.get("r") or {}
        for r in rows:
            was = prev.get(r["pid"])
            r["d1"] = (int(was) - r["rank"]) if was is not None else None
        from_iso, hours = best.get("t"), round(best_age, 1)
    else:
        for r in rows:
            r["d1"] = None

    # Append this run, then prune. Stored as pid -> rank only; the full board is
    # far too large to keep several days of.
    snaps.append({"t": now.replace(microsecond=0).isoformat(),
                  "r": {r["pid"]: r["rank"] for r in rows}})
    cutoff = now - datetime.timedelta(days=HIST_KEEP_DAYS)
    snaps = [s for s in snaps
             if (_parse_iso(s.get("t") or "") or now) >= cutoff]
    try:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"snapshots": snaps}, f, separators=(",", ":"))
        os.replace(tmp, path)
    except Exception as e:
        print(f"  ! could not write {HIST_FILE}: {e}", file=sys.stderr)

    return from_iso, hours, len(snaps)


def main():
    state = fetch_json(f"{API}/state/nfl") or {}
    season = state.get("season") or str(datetime.date.today().year)

    idmap = load_idmap()
    names, sleeper_teams, info = load_sleeper_db()

    fp_ranks, fp_extra = src_fantasypros(idmap, names, sleeper_teams, info)
    espn_ranks, espn_adps, espn_proj = src_espn(season, names, sleeper_teams)
    fd_ranks = src_firstdown()
    fcalc_ranks = src_fantasycalc()
    ffc_adps, ffc_sds, ffc_meta = src_ffc(season, 12, names, sleeper_teams)
    sleeper_adps, sleeper_projs = src_sleeper_adp(season)
    trending = src_trending()
    pw_opps = src_playoff_sos(season)

    # ADP and trade value aren't ranks; convert to orderings before blending so
    # every source contributes on the same 1..N scale.
    src_ranks = {
        "fp":       fp_ranks,
        "espn":     espn_ranks,
        "fd":       fd_ranks,
        "fcalc":    fcalc_ranks,
        "ffc_adp":  to_rank(ffc_adps),
        "espn_adp": to_rank(espn_adps),
        "sleeper_adp": to_rank(sleeper_adps),
    }
    counts = {k: len(v) for k, v in src_ranks.items()}
    print("  source depth:", counts)

    every_pid = set()
    for v in src_ranks.values():
        every_pid |= set(v)

    rows = []
    # Sorted, not raw set order: str hashing is randomized per process, so
    # iterating the set directly makes row order differ between runs — which the
    # stable sort below then preserves inside every tie. See the tie-break there.
    for pid in sorted(every_pid):
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
            # Tie-break only — stripped before the board is written. Medians of
            # small integer samples collide constantly (about half the top 120
            # shares a blend with someone), and without a deterministic
            # tie-break those players reorder randomly on every rebuild, which
            # the movement history then reports as real consensus movement.
            # Mean is the natural second opinion: same inputs, finer resolution,
            # and among equal medians the lower mean is the more broadly liked
            # player. Outlier sensitivity is fine here — it only ever separates
            # players the median already called equal.
            "_mean": round(statistics.fmean(have), 4),
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
            # VORP previously ran on ESPN projections alone, which was its main
            # weakness. Sleeper publishes its own, so average the two when both
            # exist — still not a real consensus, but two beats one.
            "proj":  _blend_proj(espn_proj.get(pid), sleeper_projs.get(pid)),
            # Sleeper ADP leads: it's the ADP of the room this draft is actually
            # held in, so it predicts THIS draft better than FFC's or ESPN's
            # populations do. FFC remains the fallback (and still supplies the
            # per-player stdev below, which Sleeper doesn't publish).
            "adp":   round(sleeper_adps[pid], 1) if pid in sleeper_adps else (
                     round(ffc_adps[pid], 1) if pid in ffc_adps else (
                     round(espn_adps[pid], 1) if pid in espn_adps else None)),
            "adp_src": ("sleeper" if pid in sleeper_adps else
                        ("ffc" if pid in ffc_adps else
                         ("espn" if pid in espn_adps else None))),
            # stdev only exists for FFC-covered players; the page falls back to
            # a size heuristic for the rest of the availability model.
            "adp_sd": round(ffc_sds[pid], 1) if pid in ffc_sds else None,
            "age":   _f(meta_i.get("age")),
            "exp":   _f(meta_i.get("exp")),
            "dc":    meta_i.get("dc"),
            "trend": trending.get(pid),
        })

    # blend -> mean -> source count (more sources = better established) -> pid.
    # The pid backstop guarantees a total order, so a rebuild with unchanged
    # inputs always produces the identical board.
    rows.sort(key=lambda r: (r["blend"], r["_mean"], -r["n"], r["pid"]))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
        del r["_mean"]
    # Positional rank off the blended board, so it stays consistent with `rank`.
    pc = {}
    for r in rows:
        pc[r["pos"]] = pc.get(r["pos"], 0) + 1
        r["posrank"] = pc[r["pos"]]
        # Value: where the market drafts him vs where the blend ranks him.
        r["value"] = round(r["adp"] - r["rank"], 1) if r["adp"] is not None else None

    # ---- playoff SOS (weeks 15-17) ------------------------------------------
    # Difficulty proxy: opponents' rank in OUR blended DEF board (posrank 1 =
    # the consensus-best fantasy defense). Facing highly-ranked defenses in the
    # fantasy playoffs = harder. It's a rough proxy — fantasy DEF value and
    # real-defense stinginess only loosely correlate — and it's labelled as such
    # on the page, but it's self-consistent and costs no extra source.
    def_rank = {r["pid"]: r["posrank"] for r in rows if r["pos"] == "DEF"}
    playoff_sos = {}
    if pw_opps and def_rank:
        scored = []
        for team, games in pw_opps.items():
            opp_ranks = [def_rank.get(g[1].split()[-1], 16.5) for g in games]
            score = round(sum(opp_ranks) / len(opp_ranks), 1) if opp_ranks else 16.5
            scored.append((team, score, [f"W{w} {o}" for w, o in sorted(games)]))
        # Higher mean opponent-DEF-rank = weaker defenses faced = easier slate.
        scored.sort(key=lambda t: -t[1])
        n = len(scored)
        for i, (team, score, games) in enumerate(scored):
            grade = "easy" if i < n / 3 else ("hard" if i >= 2 * n / 3 else "avg")
            playoff_sos[team] = {"grade": grade, "score": score, "games": games}

    gggg_def = gggg_def_shift(season)

    now = datetime.datetime.now(datetime.timezone.utc)
    os.makedirs(OUT_DIR, exist_ok=True)      # history writes here too
    delta_from, delta_hours, n_snaps = rank_deltas(rows, now)

    payload = {
        "generated": now.replace(microsecond=0).isoformat(),
        "delta_from":  delta_from,           # null until there's history to diff
        "delta_hours": delta_hours,
        "season":    season,
        "scoring":   "ppr",
        "method":    "median of per-source rankings",
        "sources": {
            "fp":       {"label": "FantasyPros ECR", "kind": "expert", "n": counts["fp"]},
            "espn":     {"label": "ESPN rank",       "kind": "expert", "n": counts["espn"]},
            "fd":       {"label": "FirstDown Studio", "kind": "expert", "n": counts["fd"]},
            "fcalc":    {"label": "FantasyCalc",     "kind": "market", "n": counts["fcalc"]},
            "ffc_adp":  {"label": "FFC ADP",         "kind": "market", "n": counts["ffc_adp"],
                         **(ffc_meta or {})},
            "espn_adp": {"label": "ESPN ADP",        "kind": "market", "n": counts["espn_adp"]},
            "sleeper_adp": {"label": "Sleeper ADP",  "kind": "market", "n": counts["sleeper_adp"]},
        },
        "counts": {"players": len(rows),
                   "all_src":  sum(1 for r in rows if r["n"] == len(SOURCES)),
                   "tiered":   sum(1 for r in rows if r.get("tier")),
                   "adp_sd":   sum(1 for r in rows if r.get("adp_sd")),
                   "sleeper_adp": sum(1 for r in rows if r.get("adp_src") == "sleeper"),
                   "trending": sum(1 for r in rows if r.get("trend"))},
        "playoff_sos": playoff_sos,      # {} if the schedule fetch failed
        "gggg_def": gggg_def,            # {} if the league/stats fetch failed
        "players": rows,
    }

    path = os.path.join(OUT_DIR, "board.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)
    moved = sum(1 for r in rows if r.get("d1"))
    print(f"board.json: {len(rows)} players "
          f"({payload['counts']['all_src']} in all {len(SOURCES)} sources, "
          f"{payload['counts']['tiered']} tiered) -> {path}")
    print(f"  gggg def adj: "
          + (f"{len(gggg_def)} team(s) shift under GGGG scoring"
             if gggg_def else "unavailable (page hides the toggle)"))
    print(f"  history: {n_snaps} snapshot(s) kept; "
          + (f"movement vs {delta_hours}h ago, {moved} players moved"
             if delta_from else "no comparison snapshot yet (needs a prior run)"))


if __name__ == "__main__":
    main()
