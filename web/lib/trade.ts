import type { EcrFull, TradePlayer } from "@/lib/data";

/* Trade Lab uses two separate value lenses, and conflating them is the easy
 * mistake — they answer different questions:
 *
 *   startVal   weekly fantasy points. Decides who starts, and therefore the
 *              win-now lineup delta.
 *   tradeVal   a smooth market curve over overall consensus rank (ECR). #1
 *              overall ≈ 100, decaying so scarcity at the top is respected and
 *              values stay comparable ACROSS positions — raw weekly points
 *              inflate QBs and would call every QB trade a fleecing.
 *
 * Transcribed from trade.html; the curve constants are load-bearing. */

export const FLOOR_VAL = 0.5; // unranked deep-bench players: negligible, not zero

export const slotLabel = (s: string) =>
  ({ WRRB_FLEX: "W/R", REC_FLEX: "W/T", SUPER_FLEX: "SFLX" })[s] ?? s;

export const makeStartVal = (useProj: boolean) => (p: TradePlayer) =>
  useProj && p.proj ? p.proj : p.ppg ?? 0;

const cval = (ecr: number | null | undefined) =>
  ecr == null || !isFinite(ecr) ? null : Math.round(1000 * Math.exp(-(ecr - 1) / 60)) / 10;

export const makeEcrLookup = (ecr: EcrFull | null) => (pid: string) =>
  ecr?.players?.[String(pid)] ?? null;

export const makeTradeVal =
  (lookup: (pid: string) => { ecr: number | null } | null) => (p: TradePlayer) => {
    const e = lookup(p.pid);
    const v = e ? cval(e.ecr) : null;
    return v == null ? FLOOR_VAL : v;
  };

export type Lineup = { picks: (TradePlayer | null)[]; total: number; full: boolean };

/** Best legal lineup from a pool: fixed slots first, then flex, greedy by points. */
export function optimal(
  players: TradePlayer[],
  slots: string[],
  flexMap: Record<string, string[]>,
  startVal: (p: TradePlayer) => number,
): Lineup {
  const pool = [...players].sort((x, y) => startVal(y) - startVal(x));
  const used = new Set<string>();
  const picks: (TradePlayer | null)[] = slots.map(() => null);

  slots.forEach((slot, i) => {
    if (flexMap[slot]) return;
    for (const p of pool) {
      if (used.has(p.pid)) continue;
      if (p.pos === slot) {
        picks[i] = p;
        used.add(p.pid);
        break;
      }
    }
  });

  slots.forEach((slot, i) => {
    const elig = flexMap[slot];
    if (!elig) return;
    for (const p of pool) {
      if (used.has(p.pid)) continue;
      if (elig.includes(p.pos)) {
        picks[i] = p;
        used.add(p.pid);
        break;
      }
    }
  });

  return {
    picks,
    total: picks.reduce((s, p) => s + (p ? startVal(p) : 0), 0),
    full: picks.every(Boolean),
  };
}

export const posCounts = (players: TradePlayer[]) => {
  const c: Record<string, number> = {};
  players.forEach((p) => {
    c[p.pos] = (c[p.pos] ?? 0) + 1;
  });
  return c;
};
