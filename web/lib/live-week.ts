/* Reading a week while it is still being played.
 *
 * now.json says what has been scored. The NFL game table says how much football
 * is left to score it in. Together they answer the question the stored
 * `win_prob_a` cannot: given this scoreboard, at this hour, who wins?
 *
 * `win_prob_a` is computed by the builder from the two pre-game projections and
 * never changes after kickoff. At 4pm on Sunday it is describing a game that
 * stopped existing at 1pm — a team 40 points down with everyone finished still
 * reads 50/50. Everything here is derived in the browser instead, because it
 * also has to follow whichever projection source the reader has selected.
 */

import type { NflGame, NowFile, NowPlayer, NowSide } from "@/lib/data";

/** Full-week spread of a head-to-head margin, in points. Same constant the
 *  builder uses, and the same one `winProb` in components/gggg/proj-source.tsx
 *  is documented against. */
export const SD_FULL = 27;

/** Never claim certainty while a single snap is left. */
const SD_FLOOR = 1.5;

const QUARTER_MINUTES = 15;
const GAME_MINUTES = 60;

/** How much of a game is still to be played, 0…1. */
export function gameRemaining(g?: NflGame | null): number {
  if (!g) return 1;                       // unknown game: treat as all to come
  if (g.status === "final" || g.quarter === "F") return 0;
  if (g.status === "pre") return 1;

  /* Overtime is a coin-flip's worth of football left, and there is no clean way
     to scale it — it ends the moment somebody scores. */
  if (g.quarter.toUpperCase().startsWith("OT")) return 0.05;

  const q = parseInt(g.quarter, 10);
  if (!q || q < 1 || q > 4) return 1;
  const [mm, ss] = (g.clock || "15:00").split(":").map((n) => parseInt(n, 10));
  const left = Number.isFinite(mm) ? mm + (Number.isFinite(ss) ? ss / 60 : 0) : QUARTER_MINUTES;
  const played = (q - 1) * QUARTER_MINUTES + (QUARTER_MINUTES - left);
  return Math.min(1, Math.max(0, 1 - played / GAME_MINUTES));
}

export const gameOf = (now: NowFile, team?: string | null): NflGame | undefined =>
  team ? now.nfl_games?.[team] : undefined;

export type SideOutlook = {
  /** Points already on the board. */
  points: number;
  /** Projected points still to come from starters. */
  remaining: number;
  /** points + remaining — where this lineup is heading. */
  projected: number;
  toPlay: number;
  inPlay: number;
  played: number;
};

/** What a side has scored and what it can still score, under `projOf`. */
export function outlook(
  side: NowSide,
  now: NowFile,
  projOf: (pid: string | null | undefined, sleeper?: number | null) => number | null,
): SideOutlook {
  let remaining = 0;
  let toPlay = 0;
  let inPlay = 0;
  let played = 0;

  side.players.forEach((p: NowPlayer) => {
    if (!p.starter || !p.pid) return;
    const g = gameOf(now, p.nfl_team);
    const left = gameRemaining(g);
    /* A player mid-game keeps the share of his projection matching the share of
       his game still to be played. Crude — it assumes points arrive at an even
       rate — but far closer than the alternatives of counting him as finished
       or as not having started. */
    remaining += (projOf(p.pid, p.proj) ?? 0) * left;
    if (!g || g.status === "pre") toPlay += 1;
    else if (g.status === "live") inPlay += 1;
    else played += 1;
  });

  return {
    points: side.points,
    remaining,
    projected: side.points + remaining,
    toPlay,
    inPlay,
    played,
  };
}

/** P(side a wins) from where both lineups stand right now.
 *
 *  The spread narrows with the football left to play: with everything still to
 *  come this is the builder's pre-game model exactly, and with both lineups
 *  finished it collapses to the scoreboard. In between it scales with the square
 *  root of the share of projected points still unscored — variance accumulates
 *  with the number of independent plays left, not with the clock. */
export function liveWinProb(a: SideOutlook, b: SideOutlook, preTotal: number): number {
  const margin = a.projected - b.projected;
  const remainingShare = preTotal > 0 ? (a.remaining + b.remaining) / preTotal : 0;
  const sd = Math.max(SD_FLOOR, SD_FULL * Math.sqrt(Math.max(0, remainingShare)));

  if (a.remaining <= 0 && b.remaining <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;

  const x = margin / (sd * Math.SQRT2);
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + s * y);
}

/** "Q3 8:42" / "Sun 1:00pm" / "Final" — the state of one player's game. */
export function gameLabel(g?: NflGame | null): string {
  if (!g) return "";
  if (g.status === "final") return "Final";
  if (g.status === "live") {
    const q = g.quarter === "F" ? "F" : g.quarter.toUpperCase().startsWith("OT") ? "OT" : `Q${g.quarter}`;
    return g.clock ? `${q} ${g.clock}` : q;
  }
  if (!g.kickoff) return "";
  return new Date(g.kickoff).toLocaleString(undefined, {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });
}

/* ── Lineup alerts ──────────────────────────────────────────────────────── */

/* Only a starter whose game has NOT kicked off can be alerted about, because
   only that starter can still be swapped. Once the ball is in the air the
   information is trivia, and a card full of trivia is a card people stop
   reading. */

export type AlertKind = "out" | "doubtful" | "questionable" | "news";

export type LineupAlert = {
  player: NowPlayer;
  kind: AlertKind;
  /** Detail line: body part, note, or how long ago the news broke. */
  detail: string;
  kickoff: number | null;
  /** Sort weight — the ones that can cost you the week come first. */
  weight: number;
};

const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "NA", "DNR"]);

/** How fresh a news stamp has to be to be worth surfacing. */
export const NEWS_WINDOW_MS = 12 * 60 * 60 * 1000;

export function lineupAlerts(side: NowSide, now: NowFile, at = Date.now()): LineupAlert[] {
  const out: LineupAlert[] = [];

  side.players.forEach((p) => {
    if (!p.starter || !p.pid) return;
    const g = gameOf(now, p.nfl_team);
    if (g && g.status !== "pre") return;          // already playing: nothing to do
    const kickoff = g?.kickoff ?? null;
    const detail = [p.body, p.note].filter(Boolean).join(" · ");

    if (OUT_STATUSES.has(p.injury ?? "")) {
      out.push({ player: p, kind: "out", detail: detail || (p.injury ?? ""), kickoff, weight: 0 });
      return;
    }
    if (p.injury === "Doubtful") {
      out.push({ player: p, kind: "doubtful", detail: detail || "Doubtful", kickoff, weight: 1 });
      return;
    }
    if (p.injury === "Questionable") {
      out.push({ player: p, kind: "questionable", detail: detail || "Questionable", kickoff, weight: 2 });
      return;
    }
    if (p.news && at - p.news < NEWS_WINDOW_MS) {
      const mins = Math.round((at - p.news) / 60000);
      const when = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
      out.push({ player: p, kind: "news", detail: `News ${when}`, kickoff, weight: 3 });
    }
  });

  return out.sort((x, y) => x.weight - y.weight || (x.kickoff ?? 0) - (y.kickoff ?? 0));
}

/* ── League-wide, as it stands ──────────────────────────────────────────── */

export type WeekPulse = {
  top: { team: string; points: number } | null;
  closest: { a: string; b: string; margin: number } | null;
  biggest: { leader: string; trailing: string; margin: number } | null;
  /** Starters across the league whose game has not kicked off. */
  toPlay: number;
};

/** The recap cards, but for a week still in progress. */
export function weekPulse(now: NowFile): WeekPulse {
  let top: WeekPulse["top"] = null;
  let closest: WeekPulse["closest"] = null;
  let biggest: WeekPulse["biggest"] = null;
  let toPlay = 0;

  (now.games ?? []).forEach((g) => {
    [g.a, g.b].forEach((s) => {
      if (!top || s.points > top.points) top = { team: s.team, points: s.points };
      toPlay += s.to_play ?? 0;
    });
    const margin = Math.abs(g.a.points - g.b.points);
    if (!closest || margin < closest.margin) {
      closest = { a: g.a.team, b: g.b.team, margin };
    }
    if (!biggest || margin > biggest.margin) {
      const aLead = g.a.points >= g.b.points;
      biggest = {
        leader: aLead ? g.a.team : g.b.team,
        trailing: aLead ? g.b.team : g.a.team,
        margin,
      };
    }
  });

  return { top, closest, biggest, toPlay };
}
