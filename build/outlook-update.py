#!/usr/bin/env python3
"""Season outlook builder — draft grades, expected wins, and crystal-ball facts.

Writes ``outlook_<season>.json`` next to the rest of the display JSON. The draft
page picks it up and renders the 2026 preview sections; every other season and
every other page is untouched, and the file is entirely optional (draft.html
degrades to the historical recap when it is missing).

What it does, end to end:

  1. Pulls the live league (rosters, users, schedule) from Sleeper.
  2. Pulls Sleeper's weekly PPR projections for the whole season (regular season
     + playoff weeks) and the players DB (age/experience/injury/bye).
  3. Reads the draft recap (``draft_<season>.json``) this repo's main builder
     already writes, plus ``ecr.json`` for consensus rank + ADP when available.
  4. Sets each team's *optimal* lineup for every week from projections, which
     gives a weekly team strength that already prices in bye weeks and thin
     position groups.
  5. Monte-Carlo simulates the season on the real schedule with player-level
     noise, producing expected wins, playoff odds, title odds and last-place
     (punishment) odds.
  6. Grades each draft on roster strength, value against the market, and depth.
  7. Generates a pile of fun facts from the numbers above.

Nothing here writes outside ``SC_OUT_DIR``. Safe to run locally:

    SC_OUT_DIR=./www/sleeper/data python3 build/outlook-update.py
"""

import json
import math
import os
import random
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

API = "https://api.sleeper.app"
OUT_DIR = os.environ.get("SC_OUT_DIR", "/mnt/cache/appdata/www-data/sleeper/data")
LEAGUE_ID = os.environ.get("SC_LEAGUE_ID")  # default: read from meta.json
SIMS = int(os.environ.get("SC_OUTLOOK_SIMS", "20000"))
SEED = int(os.environ.get("SC_OUTLOOK_SEED", "20260816"))

# Regular season is weeks 1..PLAYOFF_START-1; playoffs run PLAYOFF_START..+2.
UA = {"User-Agent": "gggg-outlook/1.0"}

# Per-position coefficient of variation used for the weekly noise draw. These
# are the usual shape of PPR week-to-week outcomes: quarterbacks are the most
# predictable, defenses and tight ends the least.
CV = {"QB": 0.34, "RB": 0.55, "WR": 0.60, "TE": 0.62, "K": 0.46, "DEF": 0.72}
FLEX_OK = {"RB", "WR", "TE"}


# ---------------------------------------------------------------- fetch/util

def fetch(url, tries=4, backoff=1.5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:  # noqa: BLE001 - network flake, retry
            last = e
        time.sleep(backoff * (i + 1))
    print(f"  ! failed: {url} ({last})", file=sys.stderr)
    return None


def read_json(name):
    path = os.path.join(OUT_DIR, name)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_json(name, obj):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)
    print(f"  wrote {path} ({os.path.getsize(path):,} bytes)")


def zscores(vals):
    if len(vals) < 2:
        return [0.0] * len(vals)
    mu = statistics.mean(vals)
    sd = statistics.pstdev(vals) or 1.0
    return [(v - mu) / sd for v in vals]


def ordinal(n):
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def pct(x):
    return round(100.0 * x, 1)


# ---------------------------------------------------------------- projections

def load_projections(season, weeks):
    """week -> {pid: pts_ppr}, plus a pid -> meta map harvested along the way."""
    by_week, meta = {}, {}
    for w in weeks:
        rows = fetch(f"{API}/projections/nfl/{season}/{w}?season_type=regular") or []
        table = {}
        for row in rows:
            pid = str(row.get("player_id"))
            stats = row.get("stats") or {}
            pts = stats.get("pts_ppr")
            pl = row.get("player") or {}
            if pid not in meta and pl:
                pos = pl.get("position") or (pl.get("fantasy_positions") or [None])[0]
                nm = " ".join(x for x in (pl.get("first_name"), pl.get("last_name")) if x)
                meta[pid] = {"name": nm.strip() or pid, "pos": pos, "team": pl.get("team")}
            if pts is not None:
                table[pid] = float(pts)
        by_week[w] = table
        print(f"  projections wk{w}: {len(table)} players")
    return by_week, meta


def load_players():
    raw = fetch(f"{API}/players/nfl") or {}
    out = {}
    for pid, p in raw.items():
        if not isinstance(p, dict):
            continue
        pos = p.get("position") or (p.get("fantasy_positions") or [None])[0]
        is_def = p.get("position") == "DEF" or (pid.isalpha() and pid.isupper() and len(pid) <= 3)
        if is_def:
            name = p.get("full_name") or pid
            out[pid] = {"name": f"{name} D/ST", "pos": "DEF", "team": p.get("team") or pid,
                        "age": None, "exp": None, "injury": "", "bye": None}
        else:
            name = " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x).strip()
            out[pid] = {"name": name or pid, "pos": pos or "?", "team": p.get("team") or "FA",
                        "age": p.get("age"), "exp": p.get("years_exp"),
                        "injury": (p.get("injury_status") or "").strip(), "bye": None}
    return out


# ---------------------------------------------------------------- lineups

def build_slots(roster_positions):
    """Split the league's roster template into fixed slots + flex slots."""
    fixed, flex, bench = [], 0, 0
    for slot in roster_positions:
        if slot in ("BN", "IR", "TAXI"):
            bench += 1
        elif slot in ("FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX", "IDP_FLEX"):
            flex += 1
        else:
            fixed.append(slot)
    return fixed, flex, bench


def optimal_lineup(pids, points, pos_of, fixed, flex):
    """Greedy best lineup: fill fixed slots with the top eligible arm, then flex.

    Greedy is optimal here because every fixed slot takes a single position and
    the flex pool is a superset filled last.
    """
    pool = sorted(((points.get(p, 0.0), p) for p in pids), reverse=True)
    used, picks, total = set(), [], 0.0
    for slot in fixed:
        for pts, p in pool:
            if p in used or pos_of.get(p) != slot:
                continue
            used.add(p)
            total += pts
            picks.append({"slot": slot, "pid": p, "pts": pts})
            break
    for _ in range(flex):
        for pts, p in pool:
            if p in used or pos_of.get(p) not in FLEX_OK:
                continue
            used.add(p)
            total += pts
            picks.append({"slot": "FLEX", "pid": p, "pts": pts})
            break
    return total, picks, used


# ---------------------------------------------------------------- simulation

def sim_season(teams, sched, weeks, playoff_weeks, starters_by_week, pos_of, sims, rng):
    """Monte Carlo the season. Returns per-roster tallies.

    Weekly team score = sum over the *projected-optimal* starters of
    proj * Gamma(shape=1/cv^2, mean=1). Setting the lineup on projections (not
    hindsight) is what a manager actually does, and player-level noise means a
    top-heavy roster is correctly swingier than a balanced one.
    """
    rids = list(teams)
    n = len(rids)
    idx = {r: i for i, r in enumerate(rids)}

    # Pre-compute (proj, shape, scale) tuples per team per week.
    draws = {}
    for w in weeks + playoff_weeks:
        for rid in rids:
            arr = []
            for s in starters_by_week[rid].get(w, []):
                p = s["pid"]
                cv = CV.get(pos_of.get(p), 0.6)
                shape = 1.0 / (cv * cv)
                arr.append((s["pts"], shape))
            draws[(rid, w)] = arr

    def score(rid, w):
        tot = 0.0
        for mu, shape in draws[(rid, w)]:
            if mu <= 0:
                continue
            tot += mu * rng.gammavariate(shape, 1.0 / shape)
        return tot

    wins_hist = [Counter() for _ in range(n)]
    tot_wins = [0.0] * n
    tot_pf = [0.0] * n
    playoffs = [0] * n
    byes = [0] * n
    seed1 = [0] * n
    finals = [0] * n
    titles = [0] * n
    last = [0] * n
    high_pf = [0] * n
    undefeated = [0] * n
    winless = [0] * n
    week_high = [0] * n

    for _ in range(sims):
        wins = [0] * n
        pf = [0.0] * n
        scores = {}
        for w in weeks:
            wk = [0.0] * n
            for rid in rids:
                s = score(rid, w)
                wk[idx[rid]] = s
                pf[idx[rid]] += s
            scores[w] = wk
            for a, b in sched[w]:
                ia, ib = idx[a], idx[b]
                if wk[ia] > wk[ib]:
                    wins[ia] += 1
                elif wk[ib] > wk[ia]:
                    wins[ib] += 1
                else:
                    wins[ia] += 0.5
                    wins[ib] += 0.5
            hi = max(range(n), key=lambda i: wk[i])
            week_high[hi] += 1

        order = sorted(range(n), key=lambda i: (-wins[i], -pf[i]))
        for i in range(n):
            tot_wins[i] += wins[i]
            tot_pf[i] += pf[i]
            wins_hist[i][int(round(wins[i]))] += 1
        for i in order[:6]:
            playoffs[i] += 1
        for i in order[:2]:
            byes[i] += 1
        seed1[order[0]] += 1
        last[order[-1]] += 1
        high_pf[max(range(n), key=lambda i: pf[i])] += 1
        if wins[order[0]] == len(weeks):
            undefeated[order[0]] += 1
        if wins[order[-1]] == 0:
            winless[order[-1]] += 1

        # 6-team bracket: R1 3v6 / 4v5, R2 1vLo / 2vHi, R3 final.
        s1, s2, s3, s4, s5, s6 = order[:6]
        pw = playoff_weeks
        w36 = s3 if score(rids[s3], pw[0]) >= score(rids[s6], pw[0]) else s6
        w45 = s4 if score(rids[s4], pw[0]) >= score(rids[s5], pw[0]) else s5
        semiA = s1 if score(rids[s1], pw[1]) >= score(rids[w45], pw[1]) else w45
        semiB = s2 if score(rids[s2], pw[1]) >= score(rids[w36], pw[1]) else w36
        finals[semiA] += 1
        finals[semiB] += 1
        champ = semiA if score(rids[semiA], pw[2]) >= score(rids[semiB], pw[2]) else semiB
        titles[champ] += 1

    res = {}
    for rid in rids:
        i = idx[rid]
        hist = wins_hist[i]
        res[rid] = {
            "exp_wins": tot_wins[i] / sims,
            "exp_pf": tot_pf[i] / sims,
            "playoff_pct": playoffs[i] / sims,
            "bye_pct": byes[i] / sims,
            "seed1_pct": seed1[i] / sims,
            "finals_pct": finals[i] / sims,
            "title_pct": titles[i] / sims,
            "last_pct": last[i] / sims,
            "pf_crown_pct": high_pf[i] / sims,
            "week_high_rate": week_high[i] / (sims * len(weeks)),
            "undefeated_pct": undefeated[i] / sims,
            "winless_pct": winless[i] / sims,
            "wins_hist": {str(k): v / sims for k, v in sorted(hist.items())},
        }
    return res


# ---------------------------------------------------------------- main

def main():
    rng = random.Random(SEED)

    meta = read_json("meta.json") or {}
    league_id = LEAGUE_ID or meta.get("current_league_id")
    if not league_id:
        print("! no league id (meta.json missing current_league_id)", file=sys.stderr)
        return 1

    league = fetch(f"{API}/v1/league/{league_id}")
    if not league:
        print("! could not load league", file=sys.stderr)
        return 1
    season = str(league.get("season"))
    settings = league.get("settings") or {}
    playoff_start = int(settings.get("playoff_week_start") or 15)
    weeks = list(range(int(settings.get("start_week") or 1), playoff_start))
    playoff_weeks = [playoff_start, playoff_start + 1, playoff_start + 2]
    fixed, flex, bench_slots = build_slots(league.get("roster_positions") or [])

    print(f"outlook: {league.get('name')} {season} · weeks {weeks[0]}-{weeks[-1]} "
          f"· playoffs {playoff_weeks[0]}-{playoff_weeks[-1]}")

    rosters = fetch(f"{API}/v1/league/{league_id}/rosters") or []
    users = fetch(f"{API}/v1/league/{league_id}/users") or []
    if not rosters:
        print("! no rosters", file=sys.stderr)
        return 1

    umap = {u["user_id"]: u for u in users}

    def team_name(owner_id, rid):
        u = umap.get(owner_id) or {}
        md = u.get("metadata") or {}
        return md.get("team_name") or u.get("display_name") or f"Roster {rid}"

    teams = {}
    for r in rosters:
        rid = r["roster_id"]
        oid = r.get("owner_id")
        u = umap.get(oid) or {}
        md = u.get("metadata") or {}
        teams[rid] = {
            "roster_id": rid,
            "owner_id": oid,
            "team": team_name(oid, rid),
            "owner": u.get("display_name") or "",
            "avatar": (f"https://sleepercdn.com/avatars/thumbs/{u['avatar']}"
                       if u.get("avatar") else None),
            "color": (md.get("team_color") or None),
            "players": [str(p) for p in (r.get("players") or [])],
            "keepers": [str(p) for p in (r.get("keepers") or [])],
        }

    # -- projections + player meta -------------------------------------------
    proj_weeks, pmeta = load_projections(season, weeks + playoff_weeks)
    players = load_players()
    for pid, m in pmeta.items():
        if pid not in players:
            players[pid] = {"name": m["name"], "pos": m["pos"], "team": m["team"],
                            "age": None, "exp": None, "injury": "", "bye": None}
    pos_of = {pid: (players.get(pid) or {}).get("pos") for pid in players}

    # Bye weeks fall out of the projections: an NFL team with zero projected
    # players in a week is on bye that week.
    nfl_active = defaultdict(set)
    for w in weeks:
        for pid, pts in proj_weeks[w].items():
            t = (players.get(pid) or {}).get("team")
            if t and t != "FA" and pts > 0:
                nfl_active[t].add(w)
    byes = {}
    for t, ws in nfl_active.items():
        missing = [w for w in weeks if w not in ws]
        byes[t] = missing[0] if len(missing) == 1 else None
    for pid, p in players.items():
        p["bye"] = byes.get(p.get("team"))

    # -- schedule -------------------------------------------------------------
    sched = {}
    opp = {rid: {} for rid in teams}
    for w in weeks:
        rows = fetch(f"{API}/v1/league/{league_id}/matchups/{w}") or []
        pair = defaultdict(list)
        for row in rows:
            pair[row.get("matchup_id")].append(row["roster_id"])
        games = []
        for _mid, rs in sorted(pair.items(), key=lambda kv: (kv[0] is None, kv[0])):
            if len(rs) == 2:
                games.append((rs[0], rs[1]))
                opp[rs[0]][w] = rs[1]
                opp[rs[1]][w] = rs[0]
        sched[w] = games
    if not all(sched[w] for w in weeks):
        print("! schedule incomplete — some weeks have no pairings", file=sys.stderr)

    # -- weekly optimal lineups ----------------------------------------------
    starters_by_week = {rid: {} for rid in teams}
    strength = {rid: {} for rid in teams}
    bench_pts = {rid: {} for rid in teams}
    for rid, t in teams.items():
        for w in weeks + playoff_weeks:
            pts = proj_weeks[w]
            total, picks, used = optimal_lineup(t["players"], pts, pos_of, fixed, flex)
            starters_by_week[rid][w] = picks
            strength[rid][w] = total
            bench_pts[rid][w] = sum(pts.get(p, 0.0) for p in t["players"] if p not in used)

    ppg = {rid: statistics.mean(strength[rid][w] for w in weeks) for rid in teams}
    lg_ppg = statistics.mean(ppg.values())
    opp_ppg = {rid: statistics.mean(strength[opp[rid][w]][w] for w in weeks if w in opp[rid])
               for rid in teams}

    # -- simulate -------------------------------------------------------------
    print(f"  simulating {SIMS:,} seasons…")
    t0 = time.time()
    sim = sim_season(teams, sched, weeks, playoff_weeks, starters_by_week, pos_of, SIMS, rng)
    print(f"  sim done in {time.time() - t0:.1f}s")

    # Schedule luck: expected wins on the real schedule vs. against a
    # league-average opponent every week (same closed-form normal model).
    week_sd = {}
    for rid in teams:
        for w in weeks:
            var = sum((s["pts"] * CV.get(pos_of.get(s["pid"]), 0.6)) ** 2
                      for s in starters_by_week[rid][w])
            week_sd[(rid, w)] = math.sqrt(var)

    def wp(a, b, w):
        sd = math.hypot(week_sd[(a, w)], week_sd[(b, w)]) or 1.0
        return 0.5 * (1 + math.erf((strength[a][w] - strength[b][w]) / (sd * math.sqrt(2))))

    sos = {}
    for rid in teams:
        real = sum(wp(rid, opp[rid][w], w) for w in weeks if w in opp[rid])
        neutral = 0.0
        for w in weeks:
            others = [o for o in teams if o != rid]
            neutral += statistics.mean(wp(rid, o, w) for o in others)
        sos[rid] = {"real": real, "neutral": neutral, "delta": real - neutral}

    sos_rank = {rid: i + 1 for i, rid in
                enumerate(sorted(teams, key=lambda r: -opp_ppg[r]))}
    ppg_rank = {rid: i + 1 for i, rid in enumerate(sorted(teams, key=lambda r: -ppg[r]))}

    # -- positional strength --------------------------------------------------
    season_pts = {pid: sum(proj_weeks[w].get(pid, 0.0) for w in weeks) for pid in players}
    pos_strength = {}
    for rid, t in teams.items():
        # Value each group by the points it actually puts in the lineup: sum of
        # the starter-slot contributions across the season.
        grp = defaultdict(float)
        for w in weeks:
            for s in starters_by_week[rid][w]:
                grp[pos_of.get(s["pid"]) or "?"] += s["pts"]
        pos_strength[rid] = {k: v / len(weeks) for k, v in grp.items()}

    # The currency everything below is priced in: points a player actually puts
    # in his manager's starting lineup across the season. A player who never
    # cracks the lineup is worth zero here no matter how good his projection is,
    # which is the whole point — a bench body cannot win you a week.
    contrib_by_team = {}
    for rid in teams:
        c = defaultdict(float)
        for w in weeks:
            for s in starters_by_week[rid][w]:
                c[s["pid"]] += s["pts"]
        contrib_by_team[rid] = dict(c)
    lineup_pts = {pid: v for c in contrib_by_team.values() for pid, v in c.items()}
    pos_rank = {}
    for p in ("QB", "RB", "WR", "TE", "K", "DEF"):
        order = sorted(teams, key=lambda r: -pos_strength[r].get(p, 0.0))
        for i, rid in enumerate(order):
            pos_rank.setdefault(rid, {})[p] = i + 1

    # -- draft board / value --------------------------------------------------
    draft = read_json(f"draft_{season}.json") or read_json("draft.json") or {}
    picks = [p for p in (draft.get("picks") or [])]
    keepers = draft.get("keepers") or []
    ecr = read_json("ecr.json") or {}
    board = {str(r["pid"]): r for r in (ecr.get("board") or [])} if str(ecr.get("season")) == season else {}

    # Market price = the player's real ADP, shifted up by however many kept
    # players are sitting above him. Keepers never reach the board here, so
    # every pick after them happens that much earlier than a public ADP (drawn
    # from ordinary redraft leagues) would suggest. Using the ADP *value* rather
    # than its rank matters: ADP compresses badly in the last few rounds, where
    # ranking would push a 14th-round tight end 40 picks past his own price.
    kept = {str(k["pid"]) for k in keepers}
    kept_adp = sorted(r["adp"] for pid, r in board.items()
                      if pid in kept and r.get("adp") is not None)

    def market_price(r):
        ahead = sum(1 for a in kept_adp if a < r["adp"])
        return max(1.0, r["adp"] - ahead)

    pool = [r for pid, r in board.items() if pid not in kept and r.get("adp") is not None]
    market_pick = {str(r["pid"]): round(market_price(r)) for r in pool}

    for p in picks:
        pid = str(p.get("pid"))
        p["proj"] = round(season_pts.get(pid, 0.0), 1)
        p["ppg"] = round(season_pts.get(pid, 0.0) / len(weeks), 2)
        mp = market_pick.get(pid)
        p["market_pick"] = mp
        p["adp_delta"] = (p["pick"] - mp) if mp else None   # + = fell past the market
        p["bye"] = (players.get(pid) or {}).get("bye")
        p["age"] = (players.get(pid) or {}).get("age")
        p["exp"] = (players.get(pid) or {}).get("exp")

    # Value over slot, VOR style. First strip out positional baseline: a QB's 250
    # points and a tight end's 150 are not the same currency, so every player is
    # measured against the last starter-worthy player at his own position in this
    # draft (12 teams x the league's starter demand). Then compare that surplus
    # with what the pick *should* have returned — the surplus of the Nth-best
    # player in the whole draft, at N = the pick's overall number. Positive means
    # the pick beat its slot; the column sums to roughly zero across the draft.
    demand = Counter(fixed)
    demand["FLEX"] = flex
    starter_need = {
        "QB": 12 * demand.get("QB", 1),
        "RB": 12 * (demand.get("RB", 2) + 1),
        "WR": 12 * (demand.get("WR", 2) + 1),
        "TE": 12 * (demand.get("TE", 1) + 0),
        "K": 12 * demand.get("K", 1),
        "DEF": 12 * demand.get("DEF", 1),
    }
    by_pos = defaultdict(list)
    for pid in set(list(market_pick) + [str(p["pid"]) for p in picks]):
        pos = pos_of.get(pid)
        if pos:
            by_pos[pos].append(season_pts.get(pid, 0.0))
    baseline = {}
    for pos, vals in by_pos.items():
        vals.sort(reverse=True)
        n = min(starter_need.get(pos, 12), len(vals)) - 1
        baseline[pos] = vals[max(n, 0)] if vals else 0.0

    for p in picks:
        p["vor"] = round(p["proj"] - baseline.get(p["pos"], 0.0), 1)
        p["lineup"] = round(lineup_pts.get(str(p["pid"]), 0.0), 1)

    # --- draft capital, priced in starting-lineup points ---------------------
    # Raw lineup points can't be compared across positions: only twelve
    # quarterbacks start in this league and they all score, so every startable
    # QB banks ~250 points and would sweep any value list. Price each player
    # against the marginal starter at his own position instead — the last player
    # at that position who holds a lineup spot league-wide. How many that is
    # comes out of the lineups themselves, including how the flex actually got
    # used, rather than from an assumption about it.
    flex_use = Counter()
    for rid in teams:
        for w in weeks:
            for s in starters_by_week[rid][w]:
                if s["slot"] == "FLEX":
                    flex_use[pos_of.get(s["pid"])] += 1
    flex_total = sum(flex_use.values()) or 1
    n_teams = len(teams)
    fixed_count = Counter(fixed)
    # Pool is every rostered player, not just the drafted ones. A single kicker
    # added on waivers after the draft is enough to push the 12th-best drafted
    # kicker down to a non-starter, which would hand the entire position a
    # replacement level of ~0 and make every starting kicker look like the pick
    # of the draft.
    owned_pool = defaultdict(list)
    for rid in teams:
        for pid in teams[rid]["players"]:
            pos = pos_of.get(pid)
            if pos:
                owned_pool[pos].append(lineup_pts.get(pid, 0.0))
    repl = {}
    for pos, vals in owned_pool.items():
        vals.sort(reverse=True)
        need = n_teams * fixed_count.get(pos, 0) + n_teams * flex * flex_use[pos] / flex_total
        idx = max(0, min(len(vals) - 1, int(round(need)) - 1))
        repl[pos] = vals[idx]

    # Floored at zero on purpose. A player who never reaches a lineup is worth
    # nothing, and he is worth exactly the same nothing whether he is a spare
    # running back or a spare tight end — without the floor the deepest position
    # sets the most negative tail, and a 14th-round tight end who will never play
    # scores as a bargain simply for being a cheaper flavour of useless.
    for p in picks:
        p["surplus"] = round(max(0.0, p["lineup"] - repl.get(p["pos"], 0.0)), 1)

    # A pick's worth is not "how many spots did he fall" — 60 picks of value in
    # round 1 and 60 in round 12 are not the same thing at all. Build the curve
    # this draft actually produced: sort every pick by that surplus, and the nth
    # entry is what the nth overall pick was worth. The curve is steep at the top
    # and flat by the back rounds, so early picks dominate on their own, without
    # a fudge factor.
    slot_curve = sorted((p["surplus"] for p in picks), reverse=True)

    def slot_worth(n):
        if not slot_curve:
            return 0.0
        return slot_curve[max(0, min(int(n), len(slot_curve)) - 1)]

    for p in picks:
        spent = slot_worth(p["pick"])
        # Production over slot: what he gave you, against what that pick usually
        # returns. Positive = the pick beat its own draft position.
        p["slot_pts"] = round(p["surplus"] - spent, 1)
        # Market surplus: the gap between what this pick cost and what the
        # market said he cost, both converted to points through the same curve.
        # Falling 60 spots in round 1 is worth many times falling 60 in round 12.
        p["market_pts"] = (round(slot_worth(p["market_pick"]) - spent, 1)
                           if p.get("market_pick") else None)
    skill_picks = sorted((p for p in picks if p["pos"] not in ("K", "DEF")),
                         key=lambda p: p["pick"])

    # Steals/reaches need a real market price, so they are limited to players the
    # ADP feed actually covers — K/DEF included would just be noise.
    priced = {str(r["pid"]) for r in pool if r.get("adp") is not None}
    market = [p for p in skill_picks
              if p["market_pts"] is not None and str(p["pid"]) in priced]
    # A bargain you never start is not a steal, so steals have to reach the
    # lineup. Reaches carry no such filter — a reach who never starts is exactly
    # the point.
    steals = sorted((p for p in market if p["lineup"] > 0),
                    key=lambda p: -p["market_pts"])[:6]
    reaches = sorted(market, key=lambda p: p["market_pts"])[:6]
    # "Value picks" = the picks that put the most points in a lineup relative to
    # what their draft slot usually returns.
    best_proj = sorted(skill_picks, key=lambda p: -p["slot_pts"])[:6]

    picks_by_team = defaultdict(list)
    for p in picks:
        picks_by_team[p["roster_id"]].append(p)

    # -- grades ---------------------------------------------------------------
    rids = list(teams)
    depth = {rid: statistics.mean(bench_pts[rid][w] for w in weeks) for rid in rids}
    value_sum = {rid: sum(p["market_pts"] or 0.0 for p in picks_by_team[rid]
                          if p["pos"] not in ("K", "DEF")) for rid in rids}
    slot_sum = {rid: sum(p["slot_pts"] for p in picks_by_team[rid]
                         if p["pos"] not in ("K", "DEF")) for rid in rids}

    z_ppg = dict(zip(rids, zscores([ppg[r] for r in rids])))
    z_depth = dict(zip(rids, zscores([depth[r] for r in rids])))
    z_val = dict(zip(rids, zscores([value_sum[r] for r in rids])))
    z_slot = dict(zip(rids, zscores([slot_sum[r] for r in rids])))

    grade_z = {rid: 0.58 * z_ppg[rid] + 0.14 * z_depth[rid]
                    + 0.14 * z_val[rid] + 0.14 * z_slot[rid] for rid in rids}

    def letter(z):
        for cut, lab in ((1.35, "A+"), (0.95, "A"), (0.60, "A-"), (0.30, "B+"),
                         (0.05, "B"), (-0.25, "B-"), (-0.55, "C+"), (-0.90, "C"),
                         (-1.30, "C-")):
            if z >= cut:
                return lab
        return "D+"

    # -- per-team payload -----------------------------------------------------
    def pname(pid):
        return (players.get(pid) or {}).get("name") or str(pid)

    out_teams = []
    for rid in sorted(rids, key=lambda r: -sim[r]["exp_wins"]):
        t = teams[rid]
        s = sim[rid]
        wk = [{"week": w, "proj": round(strength[rid][w], 1),
               "opp": teams[opp[rid][w]]["team"] if w in opp[rid] else None,
               "opp_rid": opp[rid].get(w),
               "opp_proj": round(strength[opp[rid][w]][w], 1) if w in opp[rid] else None,
               "win_pct": round(wp(rid, opp[rid][w], w), 3) if w in opp[rid] else None}
              for w in weeks]
        worst = min(wk, key=lambda x: x["proj"])
        best = max(wk, key=lambda x: x["proj"])
        hardest = min((x for x in wk if x["win_pct"] is not None), key=lambda x: x["win_pct"])
        easiest = max((x for x in wk if x["win_pct"] is not None), key=lambda x: x["win_pct"])
        core = sorted(t["players"], key=lambda p: -season_pts.get(p, 0.0))[:5]
        tp = [p for p in picks_by_team[rid] if p["pos"] not in ("K", "DEF")]
        out_teams.append({
            "roster_id": rid,
            "owner_id": t["owner_id"],
            "team": t["team"],
            "owner": t["owner"],
            "avatar": t["avatar"],
            "proj_ppg": round(ppg[rid], 1),
            "ppg_rank": ppg_rank[rid],
            "vs_league": round(ppg[rid] - lg_ppg, 1),
            "bench_ppg": round(depth[rid], 1),
            "opp_ppg": round(opp_ppg[rid], 1),
            "sos_rank": sos_rank[rid],
            "sos_delta_wins": round(sos[rid]["delta"], 2),
            "exp_wins": round(s["exp_wins"], 2),
            "exp_losses": round(len(weeks) - s["exp_wins"], 2),
            "exp_pf": round(s["exp_pf"], 0),
            "playoff_pct": pct(s["playoff_pct"]),
            "bye_pct": pct(s["bye_pct"]),
            "seed1_pct": pct(s["seed1_pct"]),
            "finals_pct": pct(s["finals_pct"]),
            "title_pct": pct(s["title_pct"]),
            "last_pct": pct(s["last_pct"]),
            "pf_crown_pct": pct(s["pf_crown_pct"]),
            "wins_hist": s["wins_hist"],
            "grade": letter(grade_z[rid]),
            "grade_z": round(grade_z[rid], 2),
            "draft_value": round(value_sum[rid], 1),
            "slot_value": round(slot_sum[rid], 1),
            "pos": {k: round(v, 1) for k, v in pos_strength[rid].items()},
            "pos_rank": pos_rank[rid],
            "core": [{"pid": p, "name": pname(p), "pos": pos_of.get(p),
                      "proj": round(season_pts.get(p, 0.0), 0)} for p in core],
            # "Best pick" should be a player who actually starts — a 14th-round
            # tight end beats his slot trivially and would win this every time.
            "best_pick": (max([p for p in tp if p["vor"] >= 0] or tp,
                              key=lambda p: p["slot_pts"]) if tp else None),
            "worst_pick": (min(tp, key=lambda p: p["slot_pts"]) if tp else None),
            "steal": (max(tp, key=lambda p: (p["market_pts"] if p["market_pts"] is not None
                                             else -9999)) if tp else None),
            "weeks": wk,
            "best_week": best,
            "worst_week": worst,
            "hardest_week": hardest,
            "easiest_week": easiest,
        })

    # -- fun facts ------------------------------------------------------------
    facts = []

    def fact(icon, title, text):
        facts.append({"icon": icon, "title": title, "text": text})

    byname = {rid: teams[rid]["team"] for rid in rids}
    top = out_teams[0]
    bottom = out_teams[-1]

    fact("🏆", "The favorite",
         f"{top['team']} projects for {top['exp_wins']:.1f} wins and wins the whole thing in "
         f"{top['title_pct']:.0f}% of {SIMS:,} simulated seasons — "
         f"{top['title_pct'] / max(bottom['title_pct'], 0.1):.0f}× the field's longest shot.")

    hardest = min(rids, key=lambda r: sos[r]["delta"])
    easiest = max(rids, key=lambda r: sos[r]["delta"])
    fact("🪓", "Toughest road",
         f"{byname[hardest]} faces the hardest schedule in the league — opponents averaging "
         f"{opp_ppg[hardest]:.1f} a week, worth about {abs(sos[hardest]['delta']):.1f} wins "
         f"of headwind. {byname[easiest]} gets the softest ride "
         f"(+{sos[easiest]['delta']:.1f} wins of tailwind).")

    # Bye-week carnage
    bye_pain = {}
    for rid in rids:
        base = statistics.median(strength[rid][w] for w in weeks)
        w_worst = min(weeks, key=lambda w: strength[rid][w])
        bye_pain[rid] = (base - strength[rid][w_worst], w_worst)
    br = max(rids, key=lambda r: bye_pain[r][0])
    loss, wk_b = bye_pain[br]
    fact("🕳️", "Bye-week crater",
         f"Week {wk_b} guts {byname[br]}: their optimal lineup drops to "
         f"{strength[br][wk_b]:.0f} points, {loss:.0f} below their typical week. "
         f"They draw {teams[opp[br][wk_b]]['team'] if wk_b in opp[br] else 'a bye'} that week.")

    # Most concentrated roster (top-3 share of starter points)
    conc = {}
    for rid in rids:
        contrib = contrib_by_team[rid]
        tot = sum(contrib.values()) or 1.0
        top3 = sum(sorted(contrib.values(), reverse=True)[:3])
        conc[rid] = (top3 / tot, sorted(contrib.items(), key=lambda kv: -kv[1])[:3])
    cr = max(rids, key=lambda r: conc[r][0])
    share, trio = conc[cr]
    fact("🎯", "All the eggs, one basket",
         f"{byname[cr]} runs the most top-heavy roster in the league: "
         f"{pname(trio[0][0])}, {pname(trio[1][0])} and {pname(trio[2][0])} account for "
         f"{share * 100:.0f}% of their projected starting points. Glorious when healthy.")
    flat = min(rids, key=lambda r: conc[r][0])
    fact("⚖️", "Death by committee",
         f"{byname[flat]} is the opposite — no three players carry more than "
         f"{conc[flat][0] * 100:.0f}% of the load. The safest floor in the league, and the "
         f"least likely to win a week 160-92.")

    # Positional kings
    for p, label, noun, emoji in (("QB", "quarterback", "quarterbacks", "🎇"),
                                  ("RB", "backfield", "running backs", "🐎"),
                                  ("WR", "receiving corps", "receivers", "🙌"),
                                  ("TE", "tight end", "tight ends", "🎣")):
        king = min(rids, key=lambda r: pos_rank[r][p])
        chump = max(rids, key=lambda r: pos_rank[r][p])
        gap = pos_strength[king][p] - pos_strength[chump].get(p, 0.0)
        fact(emoji, f"Best {label}",
             f"{byname[king]} starts {pos_strength[king][p]:.1f} points a week worth of "
             f"{noun} (flex included) — {gap:.1f} more than {byname[chump]}, who is last. "
             f"Over {len(weeks)} weeks that's a {gap * len(weeks):.0f}-point head start.")

    # Draft value
    if steals:
        s0 = steals[0]
        fact("💎", "Steal of the draft",
             f"{s0['player']} fell to {s0['team']} at pick {s0['pick']} (R{s0['round']}), "
             f"{s0['adp_delta']} picks past his ADP — and he starts, worth {s0['lineup']:.0f} "
             f"points in the lineup. Paying a round-{s0['round']} price for a "
             f"round-{max(1, (s0['market_pick'] - 1) // n_teams + 1)} player is about "
             f"{s0['market_pts']:.0f} points of free draft capital.")
    if reaches:
        r0 = reaches[0]
        fact("🚀", "Biggest reach",
             f"{r0['team']} spent pick {r0['pick']} on {r0['player']}, "
             f"{abs(r0['adp_delta'])} picks ahead of the market — about "
             f"{abs(r0['market_pts']):.0f} lineup points of draft capital handed back. "
             f"Either they know something or the room will never let them forget it.")

    # Where the points actually came from — the answer to "do late picks matter"
    cap = defaultdict(float)
    for p in picks:
        cap[min(p["round"], 15)] += p["lineup"]
    kept_pts = sum(lineup_pts.get(str(k["pid"]), 0.0) for k in keepers)
    tot_cap = sum(cap.values()) + kept_pts
    if tot_cap > 0:
        early = sum(v for r, v in cap.items() if r <= 3)
        late = sum(v for r, v in cap.items() if r >= 10)
        dead = sum(1 for p in picks if p["lineup"] <= 0)
        fact("💰", "Where the points come from",
             f"Keepers and the first three rounds supply {(kept_pts + early) / tot_cap * 100:.0f}% "
             f"of all the points this league will start; rounds 10 and later supply "
             f"{late / tot_cap * 100:.0f}%. {dead} of the {len(picks)} picks made project to "
             f"never crack a starting lineup at all. The draft was mostly over by round four.")

    # Does the room systematically over- or under-pay for a position?
    posbias = {}
    for pos in ("QB", "RB", "WR", "TE"):
        ds = [p["adp_delta"] for p in market if p["pos"] == pos]
        if len(ds) >= 6:
            posbias[pos] = statistics.median(ds)
    if posbias:
        eager = min(posbias, key=lambda p: posbias[p])
        patient = max(posbias, key=lambda p: posbias[p])
        if posbias[eager] <= -8:
            fact("🛒", "How this room shops",
                 f"GGGG pays up for {eager}s: the median {eager} in this draft went "
                 f"{abs(posbias[eager]):.0f} picks ahead of national ADP, while the median "
                 f"{patient} went {posbias[patient]:+.0f}. Everyone here is convinced the "
                 f"{eager} run is about to start, so it does.")

    # Rookies / age
    rook = {rid: sum(1 for pid in teams[rid]["players"]
                     if (players.get(pid) or {}).get("exp") == 0) for rid in rids}
    rr = max(rids, key=lambda r: rook[r])
    if rook[rr] >= 3:
        fact("🐣", "Rookie fever",
             f"{byname[rr]} rosters {rook[rr]} rookies — the most in the league "
             f"(league average {statistics.mean(rook.values()):.1f}). High variance, high "
             f"upside, and a lot of Thursday-night sweating.")

    def avg_age(rid):
        a = [(players.get(pid) or {}).get("age") for pid in teams[rid]["players"]]
        a = [x for x in a if x]
        return statistics.mean(a) if a else 0
    old = max(rids, key=avg_age)
    young = min(rids, key=avg_age)
    fact("🧓", "Old guard vs. new blood",
         f"{byname[old]} carries the oldest roster ({avg_age(old):.1f} years on average); "
         f"{byname[young]} the youngest ({avg_age(young):.1f}). Win-now versus win-later, "
         f"in one line.")

    # NFL team stacks
    stack_best = None
    for rid in rids:
        c = Counter((players.get(pid) or {}).get("team") for pid in teams[rid]["players"])
        c.pop("FA", None)
        c.pop(None, None)
        if c:
            t, n = c.most_common(1)[0]
            if stack_best is None or n > stack_best[2]:
                stack_best = (rid, t, n)
    if stack_best:
        rid, t, n = stack_best
        fact("🧱", "Biggest stack",
             f"{byname[rid]} has {n} {t} players on the roster. When {t} play a shootout "
             f"they win the week outright; when {t} have their bye, look away.")

    # Closest / marquee games
    marquee = []
    for w in weeks:
        for a, b in sched[w]:
            marquee.append((strength[a][w] + strength[b][w], abs(strength[a][w] - strength[b][w]),
                            w, a, b))
    marquee.sort(reverse=True)
    _tot, _gap, mw, ma, mb = marquee[0]
    fact("🔥", "Game of the year",
         f"Week {mw}: {byname[ma]} vs {byname[mb]} — {strength[ma][mw]:.0f} against "
         f"{strength[mb][mw]:.0f} on paper, the highest-wattage matchup on the calendar.")

    closest = min(marquee, key=lambda x: x[1])
    margin = (f"under a tenth of a point" if closest[1] < 0.1 else f"{closest[1]:.1f} points")
    fact("🪙", "Coin flip of the year",
         f"Week {closest[2]}: {byname[closest[3]]} vs {byname[closest[4]]} projects to within "
         f"{margin}. Whoever wins that one gets to call it skill.")

    # Hardest three-week stretch
    gauntlet = None
    for rid in rids:
        for i in range(len(weeks) - 2):
            ws = weeks[i:i + 3]
            if not all(w in opp[rid] for w in ws):
                continue
            v = statistics.mean(strength[opp[rid][w]][w] for w in ws)
            if gauntlet is None or v > gauntlet[0]:
                gauntlet = (v, rid, ws)
    if gauntlet:
        v, rid, ws = gauntlet
        names = ", ".join(teams[opp[rid][w]]["team"] for w in ws)
        fact("⛰️", "The gauntlet",
             f"{byname[rid]} runs into the worst three-week stretch in the league in weeks "
             f"{ws[0]}–{ws[-1]}: {names}, averaging {v:.0f} points a week.")

    # Playoff-week form: who peaks late. Everyone gains in the playoff weeks
    # (byes are over), so this is measured relative to the league's own lift.
    late = {rid: statistics.mean(strength[rid][w] for w in playoff_weeks) -
                 statistics.mean(strength[rid][w] for w in weeks) for rid in rids}
    lift = statistics.mean(late.values())
    peak = max(rids, key=lambda r: late[r])
    fade = min(rids, key=lambda r: late[r])
    fact("📈", "Built for December",
         f"Every roster gains in weeks {playoff_weeks[0]}–{playoff_weeks[-1]} once byes clear "
         f"(+{lift:.1f} on average), but {byname[peak]} gains the most (+{late[peak]:.1f}) and "
         f"{byname[fade]} the least (+{late[fade]:.1f}). Title odds are decided on those three "
         f"weekends, not on September form.")

    # Highest-leverage single player in the league
    leverage = []
    for rid in rids:
        contrib = contrib_by_team[rid]
        if contrib:
            pid, v = max(contrib.items(), key=lambda kv: kv[1])
            leverage.append((v / sum(contrib.values()), rid, pid, v))
    leverage.sort(reverse=True)
    lshare, lrid, lpid, lv = leverage[0]
    fact("🫀", "Load-bearing wall",
         f"{pname(lpid)} is {lshare * 100:.0f}% of {byname[lrid]}'s projected starting points — "
         f"the single most load-bearing player in the league. One hamstring and the season "
         f"is a different season.")

    # Biggest projected blowout on the schedule
    blow = max(marquee, key=lambda x: x[1])
    fav, dog = (blow[3], blow[4]) if strength[blow[3]][blow[2]] > strength[blow[4]][blow[2]] else (blow[4], blow[3])
    fact("🥊", "Scheduled mismatch",
         f"Week {blow[2]}: {byname[fav]} projects {blow[1]:.0f} points clear of {byname[dog]} — "
         f"the largest gap on the calendar, and a {wp(fav, dog, blow[2]) * 100:.0f}% favorite. "
         f"Which in fantasy still means it loses one time in "
         f"{1 / max(1 - wp(fav, dog, blow[2]), 0.01):.0f}.")

    # First at each position off the board
    firsts = {}
    for p in sorted(picks, key=lambda p: p["pick"]):
        firsts.setdefault(p["pos"], p)
    qb1, te1 = firsts.get("QB"), firsts.get("TE")
    if qb1 and te1:
        fact("⏱️", "Positional runs",
             f"The first quarterback off the board was {qb1['player']} at pick {qb1['pick']} "
             f"({qb1['team']}); the first tight end was {te1['player']} at pick {te1['pick']} "
             f"({te1['team']}). Everything before that was running backs and receivers — "
             f"{sum(1 for p in picks if p['pick'] < min(qb1['pick'], te1['pick']))} of them.")

    # Who waited longest on a starting position
    waited = []
    for rid in rids:
        tp = sorted(picks_by_team[rid], key=lambda p: p["pick"])
        for pos in ("RB", "WR"):
            first = next((p for p in tp if p["pos"] == pos), None)
            if first:
                waited.append((first["pick"], rid, pos, first["player"]))
    if waited:
        wpk, wrid, wpos, wpl = max(waited)
        fact("😬", "Nerves of steel",
             f"{byname[wrid]} did not take a {wpos} until pick {wpk} ({wpl}) — the longest "
             f"anyone in the league went ignoring a starting position. Bold. Possibly correct.")

    # Longest projected favourite / underdog run
    runs = []
    for rid in rids:
        best, cur = 0, 0
        for w in weeks:
            if w in opp[rid] and wp(rid, opp[rid][w], w) > 0.5:
                cur += 1
                best = max(best, cur)
            else:
                cur = 0
        runs.append((best, rid))
    runs.sort(reverse=True)
    fact("🛣️", "Longest stretch as the favorite",
         f"{byname[runs[0][1]]} is projected to be favored in {runs[0][0]} straight weeks — "
         f"the longest run of chalk in the league. {byname[runs[-1][1]]} never gets more than "
         f"{runs[-1][0]} in a row.")

    # Luck / mismatch between talent and record
    mism = max(rids, key=lambda r: ppg_rank[r] - sorted(
        rids, key=lambda x: -sim[x]["exp_wins"]).index(r) - 1)
    wr = sorted(rids, key=lambda x: -sim[x]["exp_wins"]).index(mism) + 1
    if ppg_rank[mism] - wr >= 2:
        fact("🍀", "Punching above its weight",
             f"{byname[mism]} is only the {ordinal(ppg_rank[mism])}-strongest roster on paper "
             f"but projects to finish {ordinal(wr)} — the schedule is doing the heavy lifting.")

    # Variance kings
    vol = {}
    for rid in rids:
        sds = [week_sd[(rid, w)] for w in weeks]
        vol[rid] = statistics.mean(sds) / max(ppg[rid], 1) * 100
    swing = max(rids, key=lambda r: vol[r])
    steady = min(rids, key=lambda r: vol[r])
    fact("🎢", "Boom or bust",
         f"{byname[swing]} is the league's most volatile roster (±{vol[swing]:.1f}% week to "
         f"week); {byname[steady]} the steadiest (±{vol[steady]:.1f}%). Volatility is a "
         f"friend to bad teams and an enemy to good ones — it is the underdog's only asset.")

    # Undefeated / winless
    ud = max(rids, key=lambda r: sim[r]["undefeated_pct"])
    wl = max(rids, key=lambda r: sim[r]["winless_pct"])
    fact("🎲", "Long shots",
         f"A {len(weeks)}-0 season happens {sim[ud]['undefeated_pct'] * 100:.2f}% of the time "
         f"for {byname[ud]}; an 0-{len(weeks)} wipeout hits {byname[wl]} "
         f"{sim[wl]['winless_pct'] * 100:.2f}% of the time. Somebody has to buy the tickets.")

    # Punishment watch
    doom = max(rids, key=lambda r: sim[r]["last_pct"])
    fact("💀", "Punishment watch",
         f"{byname[doom]} finishes dead last in {sim[doom]['last_pct'] * 100:.0f}% of "
         f"simulations — the highest odds in the league. Start thinking about the forfeit now.")

    # Points-title vs. actual title
    pfk = max(rids, key=lambda r: sim[r]["pf_crown_pct"])
    if pfk != max(rids, key=lambda r: sim[r]["title_pct"]):
        fact("😤", "Most points, no trophy",
             f"{byname[pfk]} leads the league in points in "
             f"{sim[pfk]['pf_crown_pct'] * 100:.0f}% of seasons but wins the title in only "
             f"{sim[pfk]['title_pct'] * 100:.0f}%. The oldest heartbreak in fantasy.")

    # Draft-slot lesson
    slot_of = {}
    for p in picks:
        if p["round"] == 1:
            slot_of[p["roster_id"]] = p["draft_slot"]
    if slot_of:
        pairs = [(slot_of[rid], sim[rid]["exp_wins"]) for rid in rids if rid in slot_of]
        bestslot = max(pairs, key=lambda x: x[1])
        fact("🎰", "Draft slot report card",
             f"Pick {bestslot[0]} came out of this draft with the best projected season "
             f"({bestslot[1]:.1f} wins). Snake drafts are not, in fact, fair.")

    # Bye-week collisions across the league
    coll = {}
    for rid in rids:
        c = Counter()
        for pid in teams[rid]["players"]:
            b = (players.get(pid) or {}).get("bye")
            if b:
                c[b] += 1
        coll[rid] = c.most_common(1)[0] if c else (None, 0)
    worst_coll = max(rids, key=lambda r: coll[r][1])
    if coll[worst_coll][0]:
        fact("📅", "Bye-week pileup",
             f"{byname[worst_coll]} has {coll[worst_coll][1]} players sharing a Week "
             f"{coll[worst_coll][0]} bye. Plan the waiver budget accordingly.")

    # Kicker/defense trivia — the picks nobody remembers
    nrounds = (draft.get("meta", {}) or {}).get("rounds") or 14
    late_picks = [p for p in skill_picks if p["round"] >= nrounds - 2]
    if late_picks:
        best_late = max(late_picks, key=lambda p: p["vor"])
        fact("🧊", "Best late-round dart",
             f"{best_late['team']} got {best_late['player']} at pick {best_late['pick']} "
             f"(R{best_late['round']}), projected for {best_late['proj']:.0f} points — "
             f"{best_late['vor']:+.0f} against what a startable {best_late['pos']} is worth, "
             f"the best value left in the draft's final rounds.")

    # Kept-player value
    if keepers:
        kv = sorted(keepers, key=lambda k: -season_pts.get(str(k["pid"]), 0.0))
        k0 = kv[0]
        fact("🔒", "Best keeper",
             f"{k0['team']} held on to {k0['player']}, who projects for "
             f"{season_pts.get(str(k0['pid']), 0.0):.0f} PPR points — the most valuable player "
             f"kept off the board this year.")

    payload = {
        "season": season,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "league_id": league_id,
        "league_name": league.get("name"),
        "meta": {
            "sims": SIMS,
            "weeks": weeks,
            "playoff_weeks": playoff_weeks,
            "playoff_teams": int(settings.get("playoff_teams") or 6),
            "league_ppg": round(lg_ppg, 1),
            "basis": f"Sleeper weekly PPR projections, weeks {weeks[0]}–{weeks[-1]}",
            "roster_slots": fixed + ["FLEX"] * flex,
            "bench_slots": bench_slots,
        },
        "teams": out_teams,
        "steals": [{k: p[k] for k in ("round", "pick", "team", "player", "pid", "pos",
                                      "nfl_team", "proj", "adp_delta", "market_pick",
                                      "market_pts", "slot_pts", "lineup", "surplus")} for p in steals],
        "reaches": [{k: p[k] for k in ("round", "pick", "team", "player", "pid", "pos",
                                       "nfl_team", "proj", "adp_delta", "market_pick",
                                       "market_pts", "slot_pts", "lineup", "surplus")} for p in reaches],
        "value_picks": [{k: p[k] for k in ("round", "pick", "team", "player", "pid", "pos",
                                           "nfl_team", "proj", "adp_delta",
                                           "market_pts", "slot_pts", "lineup", "surplus")}
                        for p in best_proj],
        "facts": facts,
    }
    write_json(f"outlook_{season}.json", payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
