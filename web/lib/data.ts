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
export type Ecr = { mode: string; available: Record<string, EcrAvailable[]> };

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
export type WiSeason = {
  season: string;
  actual: WiRow[];
  scoring: { ppr: WiRow[]; half: WiRow[]; std: WiRow[] };
  median: WiRow[];
  no_trades: WiRow[];
  best_ball: WiRow[];
  all_play: WiRow[];
  trade_count: number;
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
export type EcrFull = Ecr & { players?: Record<string, EcrPlayer> };
