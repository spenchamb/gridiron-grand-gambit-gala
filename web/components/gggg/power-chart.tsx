"use client";

/* Power ranking by week.
 *
 * A bump chart: x is the week, y is the rank (1 at the top), one line per team.
 * Rank is the right y because the question is "who was ahead of whom".
 *
 * Twelve lines is past what colour alone can separate, so at rest the chart is
 * quiet: you in tan, the leader in white, everyone else a hairline grey. Tapping
 * a line or a legend row follows that team and gives it its own colour (--viz-N,
 * by roster_id, so a team keeps its colour whatever its rank). The legend
 * directly below names every line and is also the table view: it lists the whole
 * ranking for the chosen week. The plot runs the full width of its card (edge to
 * edge on a phone) because nothing is labelled inside it. */

import { useEffect, useRef, useState } from "react";

import type { PowerHistory } from "@/lib/data";
import { isMine, useMe } from "@/lib/me";
import { cn } from "@/lib/utils";

const ROW = 24;
const TOP = 12;
const BOTTOM = 26;
const LEFT = 26;

export function PowerChart({ history }: { history: PowerHistory }) {
  const { weeks, teams } = history;
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const me = useMe();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  if (weeks.length < 2 || !teams.length) return null;

  const n = weeks.length;
  const T = teams.length;
  const week = Math.min(sel ?? n - 1, n - 1);
  const slot = new Map([...teams].sort((a, b) => a.roster_id - b.roster_id).map((t, i) => [t.roster_id, i + 1]));
  const meId = teams.find((t) => isMine(me, t.owner_id))?.roster_id ?? null;
  const leader = [...teams].sort((a, b) => a.ranks[n - 1] - b.ranks[n - 1])[0];
  const GREY = "var(--muted-foreground)";
  /* Colour, width and opacity of a team's line. */
  const look = (id: number) =>
    focus != null
      ? focus === id
        ? { c: `var(--viz-${slot.get(id)})`, w: 3.5, o: 1 }
        : { c: GREY, w: 1.5, o: 0.18 }
      : id === meId
        ? { c: "var(--primary)", w: 3, o: 1 }
        : id === leader.roster_id
          ? { c: "var(--foreground)", w: 3, o: 1 }
          : { c: GREY, w: 1.5, o: 0.45 };

  const R = 16;
  const plotW = Math.max(0, w - LEFT - R);
  const H = TOP + (T - 1) * ROW + BOTTOM;
  const x = (i: number) => LEFT + (i * plotW) / (n - 1);
  const y = (rank: number) => TOP + (rank - 1) * ROW;
  const step = plotW / (n - 1);

  /* The emphasised lines are drawn last so they sit on top of the crowd. */
  const drawn = [...teams].sort((a, b) => look(a.roster_id).w - look(b.roster_id).w);
  const dim = (id: number) => focus != null && focus !== id;
  const toggle = (id: number) => setFocus((f) => (f === id ? null : id));

  const standing = [...teams].sort((a, b) => a.ranks[week] - b.ranks[week]);

  return (
    <div className="mt-6">
      <h3 className="mb-2 font-brand text-lg tracking-tight">Rank by week</h3>
      {/* Full-bleed on a phone: the page gutter is cancelled and the card loses its
          side borders; from sm it is an ordinary card again. */}
      <div className="@container -mx-4 border-y bg-card py-3 sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <div ref={wrap} className="w-full">
          {w > 0 && (
            <svg
              width={w}
              height={H}
              role="img"
              aria-label={`Power ranking by week for ${T} teams over ${n} weeks. ${leader.team} leads after week ${weeks[n - 1]}. The list below gives each week's full ranking.`}
              className="block select-none"
            >
              {/* One hairline per rank. */}
              {Array.from({ length: T }, (_, i) => (
                <g key={i}>
                  <line x1={LEFT} x2={LEFT + plotW} y1={y(i + 1)} y2={y(i + 1)} className="stroke-border" strokeWidth={1} />
                  <text x={LEFT - 8} y={y(i + 1)} dy="0.35em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                    {i + 1}
                  </text>
                </g>
              ))}

              <line x1={x(week)} x2={x(week)} y1={TOP - 6} y2={H - BOTTOM + 6} className="stroke-muted-foreground" strokeWidth={1} />

              {weeks.map((wk, i) => (
                <text
                  key={wk}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className={cn("text-[11px]", i === week ? "fill-foreground font-bold" : "fill-muted-foreground")}
                >
                  {step < 40 ? wk : `Wk ${wk}`}
                </text>
              ))}

              {drawn.map((t) => {
                const d = t.ranks.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r)}`).join(" ");
                const lk = look(t.roster_id);
                return (
                  <g key={t.roster_id} opacity={lk.o}>
                    <path
                      d={d}
                      fill="none"
                      stroke={lk.c}
                      strokeWidth={lk.w}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {/* A wide invisible stroke so a line is easy to tap. */}
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      onClick={() => toggle(t.roster_id)}
                      className="cursor-pointer"
                    />
                    {lk.w >= 3 && (
                      <circle
                        cx={x(week)}
                        cy={y(t.ranks[week])}
                        r={4.5}
                        fill={lk.c}
                        className="stroke-card"
                        strokeWidth={2}
                      />
                    )}
                  </g>
                );
              })}

              {/* One column per week: hover, tap or focus to read that week. */}
              {weeks.map((wk, i) => (
                <rect
                  key={wk}
                  x={x(i) - step / 2}
                  y={0}
                  width={step}
                  height={H}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`Show the week ${wk} ranking`}
                  aria-pressed={i === week}
                  onPointerEnter={() => setSel(i)}
                  onClick={() => setSel(i)}
                  onFocus={() => setSel(i)}
                  className="cursor-crosshair outline-none"
                  style={{ touchAction: "pan-y" }}
                />
              ))}
            </svg>
          )}
        </div>

        <div className="mt-3 border-t px-4 pt-3 sm:px-0">
          <div className="mb-2">
            <div className="text-sm font-bold">After week {weeks[week]}</div>
            <div className="text-xs text-muted-foreground">
              {focus != null
                ? "Tap the team again to clear it."
                : `${meId != null ? "Tan is you, the other heavy line is the leader. " : "The heavy line is the leader. "}Tap a team to follow it.`}
            </div>
          </div>
          <ol className="grid gap-x-6 @lg:grid-cols-2">
            {standing.map((t) => {
              const prev = week > 0 ? t.ranks[week - 1] : null;
              const move = prev == null ? 0 : prev - t.ranks[week];
              return (
                <li key={t.roster_id} className={cn("border-b last:border-b-0 @lg:[&:nth-last-child(2)]:border-b-0", dim(t.roster_id) && "opacity-40")}>
                  <button
                    type="button"
                    onClick={() => toggle(t.roster_id)}
                    aria-pressed={focus === t.roster_id}
                    className="flex min-h-9 w-full items-center gap-2 py-1 text-left text-sm"
                  >
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{t.ranks[week]}</span>
                    <svg width="14" height="8" aria-hidden className="shrink-0">
                      <line x1="1" x2="13" y1="4" y2="4" stroke={look(t.roster_id).c} strokeWidth={2.5} strokeLinecap="round" />
                    </svg>
                    <span className={cn("min-w-0 flex-1 truncate", isMine(me, t.owner_id) ? "font-bold" : "")}>{t.team}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t.records[week]}</span>
                    <span
                      className={cn(
                        "w-6 shrink-0 text-right text-xs font-bold tabular-nums",
                        move > 0 ? "text-ok" : move < 0 ? "text-bad" : "text-muted-foreground",
                      )}
                    >
                      {move > 0 ? `+${move}` : move < 0 ? `${move}` : "–"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
