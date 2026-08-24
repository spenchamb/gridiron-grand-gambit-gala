/* Data access for the static export.
 *
 * The cron builders on beelink write data/*.json straight into the docroot and
 * refresh on their own schedule (5 min for sleeper-gate, up to 6h for
 * sleeper-update). So the data is deliberately NOT read at build time — the
 * site would need a rebuild on every cron tick. It is fetched client-side at
 * runtime, exactly as the vanilla app.js does today.
 *
 * DATA_BASE is baked in per bundle by the build scripts in package.json, which
 * is the Next-side continuation of Phase 0: one mount-point fact, no runtime
 * path sniffing, and nothing that depends on the current URL's depth. */

export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE || "/sleeper/data";
export const FF_ONLY = process.env.NEXT_PUBLIC_FF_ONLY === "1";

export async function fetchJSON<T>(name: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${name}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

/* Shapes below are transcribed from the live JSON, not guessed. The vanilla
   pages carry these implicitly across ~3,800 lines of innerHTML; naming them
   here is most of the value of porting a page at all. */

export type TeamLatest = {
  season: string;
  team_name: string;
  [k: string]: unknown;
};

export type Team = {
  owner_id: string;
  team: string;
  owner: string;
  avatar: string | null;
  color: string | null;
  record: string;
  win_pct: number;
  pf: number;
  championships: number;
  seasons: number;
  best_finish: number;
  latest?: TeamLatest;
};

export type Meta = {
  generated_at: string;
  generated_human: string;
  seasons: string[];
  current_league_id: string;
  league_name: string;
  my_owner_id: string;
  draft_seasons: string[];
  league_status: string;
  is_live: boolean;
  nfl_season: string;
  nfl_week: number;
  nfl_season_type: string;
  matchup_seasons: string[];
  preseason: boolean;
  preseason_season: string | null;
};

export const relTime = (iso: string): string => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/* ── keepers.json ───────────────────────────────────────────────────────── */
export type KeeperCell = {
  pid: string;
  name: string;
  pos: string;
  nfl_team: string | null;
  kept: number;
  roster_year: number;
  final: boolean;
};

export type KeeperTeam = {
  owner_id: string;
  team: string;
  avatar: string | null;
  owner: string;
  keepers: Record<string, KeeperCell | null>;
};

export type Keepers = {
  seasons: string[];
  latest_season: string;
  max_keeps: number;
  teams: KeeperTeam[];
};

/* ── recap.json ─────────────────────────────────────────────────────────── */
export type RecapGame = {
  t1: string; t2: string;
  t1_pts: number; t2_pts: number;
  winner: string | null;
  margin: number; total: number;
};

export type RecapSide = { team: string; pts: number };

export type Recap = {
  has_data: boolean;
  season: string;
  status?: string;
  week?: number;
  is_regular?: boolean;
  median?: number;
  high?: RecapSide;
  low?: RecapSide;
  blowout?: { margin: number; winner: string | null; t1: string; t2: string } | null;
  nailbiter?: { margin: number; winner: string } | null;
  unlucky?: RecapSide | null;
  lucky?: RecapSide | null;
  above_median?: unknown[];
  games?: RecapGame[];
  top_players?: {
    pid: string; player: string; pos: string; nfl_team: string;
    fantasy_team: string; pts: number;
  }[];
};

/* ── players/<pid>.json ─────────────────────────────────────────────────── */
export type StatLine = Record<string, number | undefined>;

export type PlayerLogRow = {
  season: string;
  week: number;
  team: string | null;
  owner_id: string | null;
  started: boolean;
  pts: number;
  playoff?: boolean;
  st?: StatLine;
};

export type Player = {
  pid: string;
  name: string;
  pos: string;
  nfl_team: string | null;
  injury?: string;
  age?: number;
  byes?: Record<string, number>;
  nicknames?: { nick: string; team?: string }[];
  summary: {
    games: number;
    started: number;
    started_pts: number;
    ppg_started: number;
    seasons: string[];
    teams: string[];
    best?: { pts: number; season: string; week: number; team: string } | null;
  };
  log: PlayerLogRow[];
};

/* ── waivers.json ───────────────────────────────────────────────────────── */
export type WaiverOrder = {
  team: string; owner: string; color: string | null; owner_id: string;
  position?: number; faab_left?: number; faab_total?: number;
};
export type TrendingPlayer = {
  pid: string; player: string; pos: string; nfl_team: string;
  count: number; injury?: string; rostered_by?: string | null;
};
export type BestAvailable = {
  pid: string; player: string; pos: string; nfl_team: string;
  pts_ppr?: number; ppg?: number; injury?: string;
};
export type RecentMove = {
  type: string; created: number; team: string;
  add: string; add_pos: string; add_team?: string; drop?: string | null;
};
export type Waivers = {
  season: string; is_faab: boolean; budget: number;
  order: WaiverOrder[];
  best_available: Record<string, BestAvailable[]>;
  best_overall: BestAvailable[];
  trending_add: TrendingPlayer[];
  trending_drop: TrendingPlayer[];
  recent_moves: RecentMove[];
};

/* ecr.json — only the parts the waiver page reads. */
export type EcrAvailable = {
  pid: string; name: string; pos: string; team: string;
  injury?: string; ecr?: number | null; pos_rank?: string; owned?: number | null;
};
export type Ecr = {
  mode: string;
  available: Record<string, EcrAvailable[]>;
  season?: string | number;
  generated?: string;
  adp_source?: string;
};

/* ── ledger.json ────────────────────────────────────────────────────────── */
export type LedgerAsset =
  | { kind: "faab"; amount: number }
  | { kind: "pick"; label: string }
  | { kind: "player"; name: string; pos: string; nfl_team?: string; pid: string };

export type LedgerSide = {
  team: string; owner_id: string | null; color: string | null; gets: LedgerAsset[];
};

export type LedgerItem = {
  id: number; season: string; week: number; ts: number; type: string;
  owner_ids: string[];
  team?: string; owner_id?: string | null; color?: string | null;
  add?: LedgerAsset & { pid?: string }; drop?: LedgerAsset & { pid?: string };
  bid?: number | null;
  sides?: LedgerSide[];
};

export type Ledger = {
  seasons: string[]; current_season: string;
  managers: { owner_id: string; team: string; color: string | null }[];
  deadlines: Record<string, number>;
  type_counts: Record<string, number>;
  count: number;
  items: LedgerItem[];
};

/* ── playoff_watch.json / punish_watch.json ─────────────────────────────── */
export type Avenue = {
  week: number;
  opp_team: string; opp_owner_id: string | null; opp_color: string | null;
  win_prob: number | null;
  playoff_if_win?: number | null; playoff_if_lose?: number | null;
  punish_if_win?: number | null; punish_if_lose?: number | null;
};

export type WatchTeam = {
  roster_id: number; team: string; owner: string; owner_id: string;
  avatar: string | null; color: string | null;
  wins: number; losses: number; ties: number; pf: number;
  games_left: number; sos_remaining: number | null;
  status: string;
  avenues: Avenue[];
  /* playoff-only */
  playoff_rank?: number; playoff_prob?: number; bye_prob?: number | null;
  top_seed_prob?: number | null;
  proj_seed_best?: number; proj_seed_median?: number; proj_seed_worst?: number;
  /* punish-only */
  punish_rank?: number; punish_prob?: number; bottom3_prob?: number | null;
  proj_wins_low?: number; proj_wins_median?: number; proj_wins_high?: number;
};

export type Watch = {
  season: string; current_week: number; total_reg_weeks: number;
  ready: boolean; n_sims: number; teams: WatchTeam[];
  playoff_teams?: number; byes?: number;
};

/* ── whatif.json ────────────────────────────────────────────────────────── */
export type WiRow = { team: string; rank: number; record: string; pf?: number };
export type WiSeeding = {
  playoff_teams: number;
  divisions: number;
  rows: {
    team: string; record: string; pf: number;
    record_seed: number; actual_seed: number;
    div_winner: boolean; in_record: boolean; made_actual: boolean;
  }[];
};
/** Your own weekly scores replayed against all 11 other teams' schedules. */
export type WiScheduleRow = {
  team: string; rank: number;
  actual: string; actual_w: number;
  best: string; worst: string;
  median_w: number;
  /** actual wins minus the median across every schedule; + = kind schedule. */
  luck: number;
  pf: number;
};
export type WiSeason = {
  season: string;
  actual: WiRow[];
  /* te_prem and pass6 arrived later than the original three, so they are
     optional — an older cached whatif.json simply will not have them. */
  scoring: {
    ppr: WiRow[]; half: WiRow[]; std: WiRow[];
    te_prem?: WiRow[]; pass6?: WiRow[];
  };
  schedule_luck?: WiScheduleRow[];
  median: WiRow[];
  no_trades: WiRow[];
  best_ball: WiRow[];
  all_play: WiRow[];
  trade_count: number;
  /** False when weekly stats were unavailable, which makes the scoring
      variants collapse onto the real PPR column rather than differ from it. */
  have_weekly?: boolean;
  seeding?: WiSeeding | null;
};
export type WhatIf = { seasons: WiSeason[] };

/* ── projections_<season>.json ──────────────────────────────────────────── */
export type ProjWeek = {
  week: number; proj: number; opp: string | null;
  opp_proj?: number; win_pct: number | null;
};
export type ProjTeam = {
  roster_id: number; owner_id: string; team: string; owner: string;
  proj_ppg: number; bench_ppg: number; opp_ppg: number;
  sos_rank: number; sos_delta_wins: number;
  exp_wins: number; exp_losses: number;
  w10: number; w25: number; w50: number; w75: number; w90: number;
  exp_pf: number; pf10: number; pf90: number;
  /* percentages already scaled 0–100, not 0–1 */
  playoff_pct: number; bye_pct: number; finals_pct: number;
  title_pct: number; last_pct: number; pf_crown_pct: number;
  wins_hist: Record<string, number>;
  gaps: number;
  slots: Record<string, number>;
  slot_rank: Record<string, number>;
  core: { pid: string; name: string; pos: string; proj: number; lineup: number }[];
  injured: { name: string; status: string }[];
  weeks: ProjWeek[];
};
export type ProjLeader = {
  pid: string; name: string; pos: string; pos_rank: string; nfl_team: string;
  bye: number | null; injury?: string; team: string; owner_id: string;
  proj: number; ppg: number; lineup: number; share: number;
};
export type Projections = {
  season: string; generated: string; league_name?: string;
  meta: {
    sims: number; weeks: number[]; playoff_weeks: number[];
    playoff_teams: number; starters: number; slots: string[];
  };
  teams: ProjTeam[];
  leaders: ProjLeader[];
};

/* ── trade.json ─────────────────────────────────────────────────────────── */
export type TradePlayer = {
  pid: string; name: string; pos: string; nfl_team: string;
  proj?: number; ppg?: number; pts_ppr?: number;
  injury?: string; starter?: boolean;
};
export type TradeTeam = {
  roster_id: number; owner_id: string; team: string; owner: string;
  color: string; players: TradePlayer[];
};
export type TradeData = {
  season: string;
  slots: string[];
  use_projections: boolean;
  proj_week: number;
  flex_map: Record<string, string[]>;
  teams: TradeTeam[];
};

/* ecr.json players map — pid -> consensus row. */
export type EcrPlayer = { pos: string; ecr: number | null; pos_rank?: string };
/** ecr.json in full — the waiver page reads `available`, team/trade read
 *  `players`, and the draft page reads `board`. */
export type EcrFull = Ecr & {
  players?: Record<string, EcrPlayer>;
  board?: EcrBoardRow[];
};

/* ── matchups_<season>.json ─────────────────────────────────────────────── */
export type BoxPlayer = {
  pid: string; name: string; nick?: string; pos: string; nfl_team: string;
  slot: string; pts: number; starter: boolean; injury?: string;
};
export type BoxSide = {
  roster_id: number; team: string; owner: string; owner_id: string;
  color: string | null; points: number; optimal: number;
  players: BoxPlayer[]; result?: string;
};
export type BoxGame = { matchup_id: number; a: BoxSide; b: BoxSide };
export type MatchupSeason = {
  season: string;
  playoff_start: number;
  weeks_list: string[];
  teams: { roster_id: number; team: string; owner: string; owner_id: string; color: string | null }[];
  weeks: Record<string, BoxGame[]>;
};

/* ── team_<owner>.json ──────────────────────────────────────────────────── */
export type TeamRosterPlayer = {
  pid: string | null; player: string; nick?: string; pos: string; nfl_team: string;
  pts_ppr?: number; slot?: string; injury?: string; age?: number | null; exp?: number;
};
export type TeamGameLogRow = {
  week: number; opp: string; pts: number; opp_pts: number; result: "W" | "L" | "T";
};
export type TeamDraftPick = {
  round: number; pick: number; pid: string | null; player: string; pos: string; pts_ppr?: number;
};
export type TeamTransaction = {
  type: string; created: number; team?: string;
  add?: string; add_pos?: string; add_team?: string; drop?: string | null; summary?: string;
};
export type TeamEfficiency = {
  optimal: number; actual: number; left_on_bench: number; pct: number | null; weeks: number;
};
export type RecommendedRow = {
  slot: string; pid: string | null; player: string | null; pos?: string; nfl_team?: string;
  proj?: number; ppg?: number; injury?: string; pts_ppr?: number; value?: number;
};
export type TeamSeason = {
  season: string; team_name: string; finish: number | null; champion?: boolean;
  record: string; wins: number; losses: number; ties: number; pf: number; pa: number;
  roster: TeamRosterPlayer[];
  game_log: TeamGameLogRow[];
  draft_picks?: TeamDraftPick[];
  transactions?: TeamTransaction[];
  efficiency?: TeamEfficiency | null;
  recommended?: { basis: string; proj_total: number; lineup: RecommendedRow[] } | null;
};
export type TeamAllTime = {
  w: number; l: number; t: number; pf: number; pa: number;
  championships: number; best_finish: number; seasons: number; playoff_apps: number;
  win_pct: number;
  high?: { pts: number; season: string; week: number; opp?: string } | null;
  low?: { pts: number; season: string; week: number; opp?: string } | null;
};
export type TeamFile = {
  meta: { owner_id: string; team: string; owner: string; avatar: string | null; color: string | null };
  all_time: TeamAllTime;
  seasons: TeamSeason[];
};

/* ── draft_<season>.json ────────────────────────────────────────────────── */
export type DraftPick = {
  round: number; pick: number; draft_slot: number; team: string; roster_id: number;
  pid: string | null; player: string; pos: string; nfl_team: string;
  pts_ppr?: number; value_rank?: number; value?: number; pos_finish?: string;
};
export type DraftKeeper = {
  roster_id: number; team: string; owner_id: string; draft_slot: number;
  pid: string; player: string; pos: string; nfl_team: string;
};
export type DraftFile = {
  meta: {
    draft_id: string; season: string; type?: string;
    rounds: number; teams: number; start_time?: number;
    /* Set when keepers are locked but the draft has not happened yet. */
    pre_draft?: boolean;
  };
  picks: DraftPick[];
  by_round: DraftPick[][];
  keepers?: DraftKeeper[];
  steals: DraftPick[];
  busts: DraftPick[];
  team_grades: { team: string; total: number; picks: number; avg: number }[];
};

/* ecr.json board — the consensus big board. */
export type EcrBoardRow = {
  pid: string; name: string; pos: string; team: string | null;
  bye?: number | null; ecr?: number | null; pos_rank?: string; tier?: number | null;
  owned?: number | null; adp?: number | null; adp_fmt?: string; value?: number | null;
};

/* ── outlook_<season>.json (draft-time snapshot) ────────────────────────── */
export type OutlookTeam = {
  roster_id: number; team: string; owner: string;
  proj_ppg: number; ppg_rank: number; bench_ppg: number;
  exp_wins: number; title_pct: number;
  grade: string; grade_z: number;
  draft_value: number; slot_value: number;
  best_pick?: { player: string } | null;
};
export type OutlookMarketPick = {
  round: number; pick: number; team: string; player: string; pid: string;
  pos: string; nfl_team?: string; proj: number;
  adp_delta?: number | null; market_pts?: number; slot_pts?: number; lineup: number;
};
export type Outlook = {
  season: string; league_name?: string;
  meta: {
    sims: number; weeks: number[]; playoff_weeks: number[];
    playoff_teams: number; league_ppg: number; roster_slots: string[];
  };
  teams: OutlookTeam[];
  steals?: OutlookMarketPick[];
  reaches?: OutlookMarketPick[];
  value_picks?: OutlookMarketPick[];
  facts?: { icon: string; title: string; text: string }[];
};

/* ══════════════════════════════════════════════════════════════════════════
   index.html (the League hub) — the last page to port.
   Types transcribed from the live files ahead of the port; nothing imports
   them yet. It reads four files and picks one of three modes:

     preseason.json.active   -> preseason  (draft not held yet)
     now.json.active         -> in-season  (a current week exists)
     otherwise               -> complete   (season over; history is the story)

   AllTimeBars and ChampionsLedger in components/gggg/viz.tsx already consume
   history.all_time and history.seasons respectively.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── league.json ────────────────────────────────────────────────────────── */
export type LeagueStanding = {
  roster_id: number; team: string; owner: string; owner_id: string;
  avatar: string | null; season: string;
  wins: number; losses: number; ties: number; pf: number; pa: number;
  all_play: string; all_play_pct: number; luck: number; streak: string; rank: number;
};
export type PowerRank = {
  rank: number; team: string; owner: string; avatar: string | null;
  all_play_pct: number; all_play: string; pf: number; record: string; seed_rank: number;
};
export type LeagueRecord = {
  team: string; pts?: number; week?: number; season?: string; opp?: string;
  [k: string]: unknown;
};
export type BracketMatch = {
  round: number; match: number;
  t1: string | null; t2: string | null;
  t1_from?: string | null; t2_from?: string | null;
  winner: string | null; loser: string | null;
};
export type LeagueFile = {
  meta: {
    league_id: string; name: string; season: string; status: string;
    total_rosters: number; scoring: string; roster_positions: string[];
    bench_slots: number; playoff_teams: number; playoff_week_start: number;
    divisions: number; scoring_detail?: Record<string, number>;
  };
  standings: LeagueStanding[];
  scoreboard: { week: number; games: unknown[] };
  power_rankings: PowerRank[];
  /* Keyed: highest_score, lowest_score, biggest_blowout, closest_game,
     highest_matchup, luckiest, unluckiest, most_pf, fewest_pf, longest_streak */
  records: Record<string, LeagueRecord>;
  h2h: { owners: unknown[]; matrix: unknown };
  bracket: { winners: BracketMatch[]; losers: BracketMatch[] };
  transactions: TeamTransaction[];
  manager_efficiency: unknown[];
};

/* ── history.json ───────────────────────────────────────────────────────── */
export type HistoryAllTime = {
  owner: string; avatar: string | null; seasons: number;
  wins: number; losses: number; ties: number; pf: number;
  championships: number; best_finish: number; win_pct: number;
};
export type HistorySeason = {
  season: string;
  /* Absent for seasons that predate the Sleeper chain — there is no league to
     point at. Same reason `partial` exists: those rows carry a result and
     nothing else, so nothing may assume a game log behind them. */
  league_id?: string;
  champion: string | null; runner_up: string | null; regular_season: string | null;
  teams: number; status: string;
  partial?: boolean;
};
export type HistoryFile = {
  seasons: HistorySeason[];
  all_time: HistoryAllTime[];
  h2h: { owners: unknown[]; matrix: unknown };
};

/* ── now.json (in-season mode) ──────────────────────────────────────────── */
/* now.json's players carry a weekly projection alongside live points — that is
   what lets an unplayed slot show a dimmed projection instead of 0.0. */
export type NowPlayer = BoxPlayer & { proj?: number };

export type NowSide = {
  roster_id: number; team: string; owner: string; owner_id: string;
  color: string | null; avatar: string | null;
  record: string; points: number; proj: number;
  players: NowPlayer[];
};
export type NowFile = {
  active: boolean;
  season: string; week: number; phase: string;
  playoff_start: number; first_kickoff: string | null;
  projections: { season: string; week: number; available: boolean };
  slots: string[];
  /* Projected win probability for side a, present before kickoff. */
  games: { matchup_id: number; a: NowSide; b: NowSide; win_prob_a?: number | null }[];
};

/* ── preseason.json (preseason mode) ────────────────────────────────────── */
/* Inactive in the offseason, in which case only `active` is present. When it
   goes active it carries the upcoming league's settings, a season-over-season
   change diff, the draft date and keepers-by-slot. Transcribe the rest at port
   time — the shape only materialises once a new league reaches pre_draft. */
export type PreseasonFile = {
  active: boolean;
  league_id?: string;
  season?: string;
  [k: string]: unknown;
};
