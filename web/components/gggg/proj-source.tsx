"use client";

/* Which set of coming-week projections the site runs on.
 *
 * Two sources answer the same question and disagree, which is the point:
 *
 *   sleeper     Sleeper's own weekly feed, re-scored for defenses with this
 *               league's settings by sleeper-update.py. Covers every rostered
 *               player, and is what the stored side totals and win
 *               probabilities in now.json were computed from.
 *   consensus   the weekly expert consensus (build/consensus-update.py, the
 *               same file the Consensus page reads). Better start/sit signal,
 *               but it only ranks so deep — 168 of the league's 170 rostered
 *               players on the week this landed.
 *
 * One preference, shared by every page that shows a coming-week number, so the
 * League hub and Trade Lab can never be read side by side on different
 * projections. The pages render their own switch; flipping it anywhere moves
 * all of them, and it persists.
 *
 * Where consensus has no number for a player the Sleeper value stands in, and
 * `coverage` reports how often that happened so a page can say so rather than
 * quietly mixing the two. */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchJSON, type Consensus } from "@/lib/data";
import { Segmented } from "@/components/gggg/segmented";
import { cn } from "@/lib/utils";

export type ProjSrc = "sleeper" | "consensus";

const KEY = "gggg.projsrc.v1";
const DEFAULT: ProjSrc = "sleeper";

/* Module-level store rather than context: the pages that need this are three
   unrelated routes with no common provider below the root layout, and a
   preference this small does not justify wrapping the whole app. */
let src: ProjSrc = DEFAULT;
let hydrated = false;
let data: Consensus | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/* Every mutation goes through bump(): useSyncExternalStore compares snapshots
   by identity, so notifying listeners without moving the version is a no-op
   render and the loaded payload would never reach the page. */
let version = 0;
const bump = () => {
  version += 1;
  listeners.forEach((l) => l());
};

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const v = localStorage.getItem(KEY);
    if (v === "sleeper" || v === "consensus") src = v;
  } catch {}
}

function load() {
  if (loading) return loading;
  loading = fetchJSON<Consensus>("consensus.json")
    .then((d) => {
      /* ready:false is the offseason payload — no weekly ranks exist, so the
         switch must not offer a source that would render every row as "—". */
      data = d?.ready ? d : null;
    })
    .catch(() => {
      data = null;
    })
    .finally(bump);
  return loading;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => version;
const getServerSnapshot = () => 0;

export type ProjSource = {
  src: ProjSrc;
  setSrc: (s: ProjSrc) => void;
  /** True when consensus data is loaded AND selected. */
  usingConsensus: boolean;
  /** True when there is a consensus payload to switch to at all. */
  available: boolean;
  week: number | null;
  /** Projection under the active source, with the Sleeper value as fallback. */
  projOf: (pid: string | null | undefined, sleeper?: number | null) => number | null;
  /** Matchup grade for a player, consensus only — null under Sleeper. */
  gradeOf: (pid: string | null | undefined) => string | null;
  /** How many of `pids` the active source actually covers. */
  coverage: (pids: (string | null | undefined)[]) => { covered: number; total: number };
  label: string;
};

export function useProjSource(): ProjSource {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    hydrate();
    load();
    bump();
  }, []);

  const byPid = useMemo(() => {
    const m = new Map<string, { proj: number | null; grade: string | null }>();
    Object.values(data?.rankings ?? {}).forEach((rows) =>
      (rows ?? []).forEach((r) => {
        /* A player appears on both his position page and FLEX with the same
           numbers, so first write wins and the duplicate is free. */
        if (r.pid && !m.has(r.pid)) m.set(r.pid, { proj: r.proj, grade: r.grade });
      }),
    );
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const available = Boolean(data);
  const usingConsensus = available && src === "consensus";

  const setSrc = useCallback((s: ProjSrc) => {
    src = s;
    try {
      localStorage.setItem(KEY, s);
    } catch {}
    bump();
  }, []);

  const projOf = useCallback(
    (pid: string | null | undefined, sleeper?: number | null) => {
      if (!usingConsensus) return sleeper ?? null;
      const hit = pid ? byPid.get(String(pid)) : undefined;
      return hit?.proj ?? sleeper ?? null;
    },
    [usingConsensus, byPid],
  );

  const gradeOf = useCallback(
    (pid: string | null | undefined) =>
      usingConsensus && pid ? (byPid.get(String(pid))?.grade ?? null) : null,
    [usingConsensus, byPid],
  );

  const coverage = useCallback(
    (pids: (string | null | undefined)[]) => {
      const real = pids.filter(Boolean) as string[];
      if (!usingConsensus) return { covered: real.length, total: real.length };
      return {
        covered: real.filter((p) => byPid.get(String(p))?.proj != null).length,
        total: real.length,
      };
    },
    [usingConsensus, byPid],
  );

  return {
    src: available ? src : "sleeper",
    setSrc,
    usingConsensus,
    available,
    week: data?.week ?? null,
    projOf,
    gradeOf,
    coverage,
    label: usingConsensus ? "consensus" : "Sleeper",
  };
}

const OPTIONS: readonly (readonly [ProjSrc, string])[] = [
  ["sleeper", "Sleeper"],
  ["consensus", "Consensus"],
];

/** The switch itself. Renders nothing when there is no consensus data to
 *  switch to, so the offseason simply never sees a dead control.
 *
 *  `caption` is for pages that already carry another Segmented next to this one
 *  — Waivers sorts by consensus rank a few pixels away, and two unlabelled
 *  tracks that both say "Consensus" are indistinguishable at a glance. */
export function ProjSourceToggle({
  source, className, caption,
}: { source: ProjSource; className?: string; caption?: string }) {
  if (!source.available) return null;
  const control = (
    <Segmented<ProjSrc>
      label="Projection source"
      options={OPTIONS}
      value={source.src}
      onChange={source.setSrc}
      className={caption ? cn("mb-0", className) : className}
    />
  );
  if (!caption) return control;
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {caption}
      </span>
      {control}
    </div>
  );
}

/** Standard normal CDF of a projected margin — the client-side twin of
 *  sleeper-update.py's `_win_prob`, so a matchup's odds keep the same meaning
 *  when the projections underneath them change. Same 27-point weekly spread.
 *
 *  erf via Abramowitz & Stegun 7.1.26: max error 1.5e-7, which is four orders
 *  of magnitude finer than the whole number of percent this ends up rendered as. */
export function winProb(margin: number, sd = 27): number {
  const x = margin / (sd * Math.SQRT2);
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return 0.5 * (1 + s * y);
}
