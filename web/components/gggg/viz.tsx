"use client";

/* React port of www/assets/viz.js (window.SCviz).
 *
 * Four pieces, two consumers: Odometer + PositionalBattle are used by Matchups;
 * AllTimeBars + ChampionsLedger are used by the League hub (index), which is the
 * last page to port. All four land here now so index has no viz work left.
 *
 * The original animates by writing inline styles inside a double-rAF. Here the
 * same effect is a mount transition — width/transform start at 0 and move to
 * their target after the first paint. */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Run once after the browser has painted, so a CSS transition actually fires. */
function useAfterPaint() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

/* ── Mechanical rolling-digit odometer ──────────────────────────────────── */
export function Odometer({
  value, decimals = 1, className,
}: { value: number; decimals?: number; className?: string }) {
  const ready = useAfterPaint();
  const text = Number(value).toFixed(decimals);
  let digitIndex = 0;

  return (
    <span
      className={cn("inline-flex items-baseline font-mono tabular-nums", className)}
      aria-label={text}
    >
      {[...text].map((ch, i) => {
        if (ch < "0" || ch > "9")
          return (
            <span key={i} aria-hidden>
              {ch}
            </span>
          );
        const d = +ch;
        const delay = digitIndex++ * 70;
        return (
          <span key={i} className="inline-block h-[1em] overflow-hidden" aria-hidden>
            <span
              className="flex flex-col transition-transform duration-[950ms] ease-[cubic-bezier(.2,.85,.25,1)] motion-reduce:transition-none"
              style={{
                transform: `translateY(-${ready ? d * 10 : 0}%)`,
                transitionDelay: `${delay}ms`,
              }}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} className="flex h-[1em] items-center justify-center leading-none">
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/* ── Positional battle — mirrored bars, one row per starting position ────── */
const POS_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

type BattlePlayer = { pos: string; pts: number; starter?: boolean };
type BattleSide = { team: string; color?: string | null; players: BattlePlayer[] };

const aggStarters = (players: BattlePlayer[]) => {
  const m: Record<string, number> = {};
  (players ?? []).forEach((p) => {
    if (p.starter) m[p.pos] = (m[p.pos] ?? 0) + p.pts;
  });
  return m;
};

export function PositionalBattle({ me, ot }: { me: BattleSide; ot: BattleSide }) {
  const ready = useAfterPaint();
  const A = aggStarters(me.players);
  const B = aggStarters(ot.players);

  const ordered = POS_ORDER.filter((p) => A[p] || B[p]);
  const extra = [...Object.keys(A), ...Object.keys(B)].filter((p) => !POS_ORDER.includes(p));
  const positions = [...new Set([...ordered, ...extra])];
  const max = Math.max(1, ...positions.map((p) => Math.max(A[p] ?? 0, B[p] ?? 0)));

  const ca = me.color ?? "var(--primary)";
  const cb = ot.color ?? "var(--muted-foreground)";

  return (
    <div className="my-5">
      <div className="mb-2.5 flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-bold">
          <i className="size-2.5 shrink-0" style={{ background: ca }} />
          {me.team}
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          where it was won
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1.5 truncate font-bold">
          {ot.team}
          <i className="size-2.5 shrink-0" style={{ background: cb }} />
        </span>
      </div>

      {positions.map((p) => {
        const a = A[p] ?? 0;
        const b = B[p] ?? 0;
        const aw = a > b;
        const bw = b > a;
        return (
          <div
            key={p}
            className="mb-1.5 grid items-center gap-1.5 [grid-template-columns:38px_1fr_40px_1fr_38px] sm:[grid-template-columns:42px_1fr_46px_1fr_42px]"
          >
            <div
              className={cn(
                "text-right font-mono text-xs tabular-nums",
                aw ? "font-bold text-foreground" : "text-muted-foreground",
              )}
            >
              {a.toFixed(1)}
            </div>
            <div className="flex h-3.5 justify-end">
              <span
                className={cn(
                  "h-3.5 transition-[width] duration-[800ms] ease-[cubic-bezier(.2,.85,.25,1)] motion-reduce:transition-none",
                  !aw && "opacity-[.38]",
                )}
                style={{ width: ready ? `${(a / max) * 100}%` : 0, background: ca }}
              />
            </div>
            <div className="text-center font-mono text-[11px] font-bold text-muted-foreground">
              {p}
            </div>
            <div className="flex h-3.5">
              <span
                className={cn(
                  "h-3.5 transition-[width] duration-[800ms] ease-[cubic-bezier(.2,.85,.25,1)] motion-reduce:transition-none",
                  !bw && "opacity-[.38]",
                )}
                style={{ width: ready ? `${(b / max) * 100}%` : 0, background: cb }}
              />
            </div>
            <div
              className={cn(
                "font-mono text-xs tabular-nums",
                bw ? "font-bold text-foreground" : "text-muted-foreground",
              )}
            >
              {b.toFixed(1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── All-time win% leaderboard (index) ──────────────────────────────────── */
export type AllTimeRow = {
  owner: string;
  win_pct: number;
  wins: number;
  losses: number;
  ties?: number;
  pf: number;
  championships?: number;
};

export function AllTimeBars({ rows }: { rows: AllTimeRow[] }) {
  const ready = useAfterPaint();
  const sorted = [...rows].sort((a, b) => b.win_pct - a.win_pct);
  const max = Math.max(...sorted.map((r) => r.win_pct)) || 1;

  return (
    <div className="flex flex-col">
      {sorted.map((r, i) => {
        const gp = r.wins + r.losses + (r.ties ?? 0);
        const ppg = gp ? r.pf / gp : 0;
        return (
          <div
            key={r.owner}
            className="grid items-center gap-2 border-b py-1.5 last:border-0 [grid-template-columns:20px_1fr_minmax(56px,30%)_44px] sm:[grid-template-columns:22px_minmax(72px,1fr)_minmax(70px,38%)_50px_auto]"
          >
            <span className="text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
            <span className="truncate text-[13px]">{r.owner}</span>
            <span className="h-3">
              <span
                className={cn(
                  "block h-3 transition-[width] duration-[850ms] ease-[cubic-bezier(.2,.85,.25,1)] motion-reduce:transition-none",
                  r.championships ? "bg-warn" : "bg-primary",
                )}
                style={{ width: ready ? `${(r.win_pct / max) * 100}%` : 0 }}
              />
            </span>
            <span className="text-right font-mono text-xs tabular-nums">
              {(r.win_pct * 100).toFixed(1)}%
            </span>
            <span className="hidden items-center justify-end gap-1.5 sm:flex">
              {r.championships ? (
                <span className="text-[11px]">{"\u{1F3C6}".repeat(r.championships)}</span>
              ) : null}
              <span className="font-mono text-[11px] text-muted-foreground">
                {ppg.toFixed(1)} pg
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Champions ledger (index) ───────────────────────────────────────────── */
export type ChampSeason = {
  season: string;
  champion?: string | null;
  runner_up?: string | null;
  regular_season?: string | null;
  teams?: number;
};

export function ChampionsLedger({ seasons }: { seasons: ChampSeason[] }) {
  return (
    <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
      {(seasons ?? []).map((s) => (
        <div key={s.season} className="rounded-lg border bg-card px-3.5 py-3">
          <div className="font-mono text-[13px] tracking-[0.08em] text-muted-foreground">
            {s.season}
          </div>
          <div className="my-1 flex items-center gap-2">
            <span className="text-base">🏆</span>
            <span className="text-base font-bold">{s.champion ?? "—"}</span>
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            def. {s.runner_up ?? "—"}
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            reg. #1 {s.regular_season ?? "—"}
            {s.teams ? ` · ${s.teams} tms` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Small helper the matchups box score uses for its result pill. */
export function ResultBadge({ kind, children }: { kind: "w" | "l" | "t"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-md px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wider",
        kind === "w" && "bg-ok text-background",
        kind === "l" && "bg-bad text-background",
        kind === "t" && "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export const useMounted = useAfterPaint;
