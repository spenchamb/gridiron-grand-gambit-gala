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
