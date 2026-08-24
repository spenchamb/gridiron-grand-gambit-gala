"use client";

import { useEffect, useState } from "react";
import {
  fetchJSON, relTime,
  type Meta, type WhatIf, type WiRow, type WiScheduleRow, type WiSeason,
} from "@/lib/data";
import { PageHeader, Note } from "@/components/gggg/primitives";
import { Segmented } from "@/components/gggg/segmented";
import { cn } from "@/lib/utils";

/* A season is worth rendering once any regular-season game has been played.
   Before that every scenario is twelve rows of 0-0, which reads as broken
   rather than as "not yet". */
const played = (ws: WiSeason) =>
  (ws.actual ?? []).some((r) => /[1-9]/.test(r.record ?? ""));

const Delta = ({ actual, rank }: { actual?: number; rank: number }) => {
  if (actual == null) return null;
  const d = actual - rank;
  if (d > 0) return <span className="font-bold text-ok">▲ {d}</span>;
  if (d < 0) return <span className="font-bold text-bad">▼ {-d}</span>;
  return <span className="text-muted-foreground">—</span>;
};

function StandingsTable({
  rows, actual, pf = false, recordLabel = "Record",
}: { rows: WiRow[]; actual: Map<string, number>; pf?: boolean; recordLabel?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[360px] text-sm">
        <thead>
          <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
            <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Team</th>
            <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">{recordLabel}</th>
            {pf && <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">PF</th>}
            <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">vs Actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team} className="border-b last:border-0">
              <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{r.rank}</td>
              <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-bold">{r.team}</td>
              <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">{r.record}</td>
              {pf && (
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {(r.pf ?? 0).toFixed(0)}
                </td>
              )}
              <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono">
                <Delta actual={actual.get(r.team)} rank={r.rank} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniStandings({
  title, sub, rows, actual,
}: { title: string; sub?: string; rows?: WiRow[]; actual: Map<string, number> }) {
  if (!rows?.length) return null;
  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="mb-2">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.13em] text-primary">
          {title}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.team}>
              <td className="w-5 py-1 pr-1.5 font-mono text-muted-foreground">{r.rank}</td>
              {/* max-w-0 + w-full is what makes truncate work inside a table
                  cell: without it the cell sizes to its content and the row
                  pushes the numbers off instead of the name shortening. */}
              <td className="w-full max-w-0 truncate py-1 pr-1.5 font-bold">{r.team}</td>
              <td className="whitespace-nowrap py-1 pr-1.5 text-right font-mono tabular-nums">
                {r.record}
              </td>
              <td className="whitespace-nowrap py-1 pr-1.5 text-right font-mono tabular-nums text-muted-foreground">
                {(r.pf ?? 0).toFixed(0)}
              </td>
              <td className="whitespace-nowrap py-1 text-right font-mono">
                <Delta actual={actual.get(r.team)} rank={r.rank} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Schedule luck — the spread of records the same scores could have produced. */
function ScheduleLuck({ rows }: { rows: WiScheduleRow[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.luck)));
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[340px] text-sm">
        <thead>
          <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-8 px-2 py-1.5 text-left sm:w-10 sm:px-3 sm:py-2">#</th>
            <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Team</th>
            <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Actual</th>
            <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">Best</th>
            <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">Worst</th>
            <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Luck</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team} className="border-b last:border-0">
              <td className="px-2 py-1.5 font-mono text-muted-foreground sm:px-3 sm:py-2">{r.rank}</td>
              <td className="max-w-0 truncate px-2 py-1.5 font-bold sm:px-3 sm:py-2">
                {r.team}
                {/* On a phone the best/worst columns are gone, so the range
                    rides along under the name where it still fits. */}
                <span className="block font-mono text-[10px] font-normal text-muted-foreground sm:hidden">
                  {r.worst} … {r.best}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums sm:px-3 sm:py-2">
                {r.actual}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-ok sm:table-cell sm:px-3 sm:py-2">
                {r.best}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-bad sm:table-cell sm:px-3 sm:py-2">
                {r.worst}
              </td>
              <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                <div className="flex items-center justify-end gap-1.5">
                  <span
                    className={cn(
                      "whitespace-nowrap font-mono text-xs font-bold tabular-nums",
                      r.luck > 0 ? "text-ok" : r.luck < 0 ? "text-bad" : "text-muted-foreground",
                    )}
                  >
                    {r.luck > 0 ? "+" : ""}
                    {r.luck.toFixed(1)}
                  </span>
                  <span className="hidden h-1.5 w-10 shrink-0 overflow-hidden rounded-sm bg-secondary sm:block">
                    <i
                      className={cn("block h-full", r.luck >= 0 ? "bg-ok/70" : "bg-bad/70")}
                      style={{ width: `${(Math.abs(r.luck) / max) * 100}%` }}
                    />
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Seeding({ ws }: { ws: WiSeason }) {
  const sd = ws.seeding;
  if (!sd?.rows) return null;
  const n = sd.playoff_teams;
  const moved = sd.rows.filter((r) => r.record_seed !== r.actual_seed);
  const newIn = sd.rows.filter((r) => r.in_record && !r.made_actual);
  const newOut = sd.rows.filter((r) => !r.in_record && r.made_actual);

  let note: React.ReactNode;
  if (!sd.divisions || sd.divisions < 2) {
    note = `${ws.season} didn't use divisions, so seeding was already purely by record — nothing changes.`;
  } else if (!moved.length) {
    note = (
      <>
        The league seeds its {n}-team playoff with the{" "}
        <strong className="text-foreground">{sd.divisions} division winners</strong> taking the top
        seeds. In {ws.season} the division winners also held the best records, so seeding by overall
        record produces the same bracket — no change.
      </>
    );
  } else {
    const rises = moved
      .filter((r) => r.actual_seed > r.record_seed)
      .map((r) => `${r.team} (#${r.actual_seed}→#${r.record_seed})`);
    note = (
      <>
        The league awards its top seeds to the{" "}
        <strong className="text-foreground">{sd.divisions} division winners</strong> (Sleeper&apos;s
        default). Seeding the {n}-team playoff purely by overall record in {ws.season} would
        reshuffle the bracket — {rises.length > 0 && `${rises.join(", ")} climb. `}
        {newIn.length > 0 && (
          <>
            <strong className="text-ok">would make it:</strong> {newIn.map((r) => r.team).join(", ")}
          </>
        )}
        {newIn.length > 0 && newOut.length > 0 && "; "}
        {newOut.length > 0 && (
          <>
            <strong className="text-bad">would miss:</strong> {newOut.map((r) => r.team).join(", ")}
          </>
        )}
        .
      </>
    );
  }

  return (
    <section id="sec-seeding" className="scroll-mt-6">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
        Playoff Seeding by Record{" "}
        <span className="font-sans normal-case tracking-normal">— no divisions or conferences</span>
      </p>
      <Note>{note}</Note>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[340px] text-sm">
          <thead>
            <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Seed</th>
              <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Team</th>
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Record</th>
              <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">PF</th>
              <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">League Seed</th>
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Δ</th>
              <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sd.rows.map((r) => {
              const d = r.actual_seed - r.record_seed;
              return (
                <tr
                  key={r.team}
                  className={cn(
                    "border-b last:border-0",
                    r.record_seed === n && "border-b-2 border-b-primary/60",
                  )}
                >
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{r.record_seed}</td>
                  <td className="max-w-0 px-2 py-1.5 sm:px-3 sm:py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-bold">{r.team}</span>
                      {r.div_winner && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">◆</span>
                      )}
                      {/* Status has its own column from sm up. */}
                      {r.in_record !== r.made_actual && (
                        <span
                          className={cn(
                            "shrink-0 rounded-sm px-1 py-px font-mono text-[9px] font-bold uppercase text-background sm:hidden",
                            r.in_record ? "bg-ok" : "bg-bad",
                          )}
                        >
                          {r.in_record ? "in" : "out"}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">{r.record}</td>
                  <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                    {r.pf.toFixed(0)}
                  </td>
                  <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground sm:table-cell sm:px-3 sm:py-2">
                    #{r.actual_seed}
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono">
                    {d > 0 ? (
                      <span className="font-bold text-ok">▲ {d}</span>
                    ) : d < 0 ? (
                      <span className="font-bold text-bad">▼ {-d}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">
                    {r.in_record && !r.made_actual ? (
                      <span className="rounded-sm bg-ok px-1.5 py-px font-mono text-[9px] font-bold uppercase text-background">
                        now in
                      </span>
                    ) : !r.in_record && r.made_actual ? (
                      <span className="rounded-sm bg-bad px-1.5 py-px font-mono text-[9px] font-bold uppercase text-background">
                        now out
                      </span>
                    ) : r.in_record ? (
                      <span className="rounded-sm bg-secondary px-1.5 py-px font-mono text-[9px] font-bold uppercase text-muted-foreground">
                        playoffs
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>Seed = where record alone would put them · Δ ▲ = climbs</span>
        <span>◆ = division winner</span>
      </div>
    </section>
  );
}

export default function WhatIfPage() {
  const [wi, setWi] = useState<WhatIf | null>(null);
  const [i, setI] = useState(0);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([fetchJSON<WhatIf>("whatif.json"), fetchJSON<Meta>("meta.json")])
      .then(([w, m]) => {
        setWi(w);
        /* Open on the newest season that has been played. seasons[0] is the
           current one, which in week 1 has no completed games at all — every
           table would render twelve rows of 0-0. */
        const first = w.seasons.findIndex((s) => played(s));
        if (first > 0) setI(first);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
      })
      .catch(() => setError(true));
  }, []);

  /* The page renders from JS, so an inbound #anchor has to be re-applied once
     the sections above it have filled in and shifted its position. */
  useEffect(() => {
    if (!wi || !location.hash) return;
    const el = document.querySelector(location.hash);
    if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 150);
  }, [wi]);

  const ws = wi?.seasons[i];
  const actual = new Map((ws?.actual ?? []).map((a) => [a.team, a.rank]));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow="Alternate Realities"
        title="What-If"
        subtitle={error ? "Could not load what-if data." : "Re-run each season under different rules."}
        updated={updated}
      />

      {wi && (
        <div className="mb-8">
          <Segmented
            label="Season"
            options={wi.seasons.map((s, idx) => [String(idx), s.season] as const)}
            value={String(i)}
            onChange={(v) => setI(Number(v))}
          />
        </div>
      )}

      {!wi && !error && <div className="h-64 animate-pulse rounded-lg border bg-card" />}

      {ws && !played(ws) && (
        <Note>
          No {ws.season} games have been played yet — every alternate reality is
          identical to a blank slate. Pick an earlier season above.
        </Note>
      )}

      {ws && played(ws) && (
        <div className="space-y-12">
          <section id="sec-scoring" className="scroll-mt-6">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Scoring Systems{" "}
              <span className="font-sans normal-case tracking-normal">
                — same lineups, different scoring
              </span>
            </p>
            <Note>
              <strong className="text-foreground">Full PPR</strong> reproduces the league&apos;s real
              recorded scoring exactly (to the point); every other column is that same number with
              one rule changed, using the lineups each manager actually started. Regular season only.
              {ws.have_weekly === false && (
                <>
                  {" "}
                  <strong className="text-warn">
                    Weekly player stats are unavailable for {ws.season}, so the variants below fall
                    back to the real scoring and will not differ.
                  </strong>
                </>
              )}
            </Note>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MiniStandings title="Full PPR" sub="the real thing" rows={ws.scoring.ppr} actual={actual} />
              <MiniStandings title="Half PPR" sub="0.5 per reception" rows={ws.scoring.half} actual={actual} />
              <MiniStandings title="Standard" sub="no PPR" rows={ws.scoring.std} actual={actual} />
              <MiniStandings title="TE Premium" sub="+0.5 per TE reception" rows={ws.scoring.te_prem} actual={actual} />
              <MiniStandings title="6pt Pass TD" sub="up from 4" rows={ws.scoring.pass6} actual={actual} />
            </div>
          </section>

          <section id="sec-notrade" className="scroll-mt-6">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              If No Trades Happened
            </p>
            <Note>
              {ws.trade_count === 0
                ? `No trades were made in ${ws.season} — the standings are unchanged.`
                : `${ws.trade_count} trade${ws.trade_count > 1 ? "s were" : " was"} made in ${ws.season}. This reassigns the scoring output of each traded player — for the weeks their new team actually started them — back to the team that traded them away, then replays the schedule. An approximation of a trade-free season.`}
            </Note>
            <StandingsTable rows={ws.no_trades} actual={actual} pf />
          </section>

          <section id="sec-median" className="scroll-mt-6">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Median Format{" "}
              <span className="font-sans normal-case tracking-normal">
                — beat the weekly median for a bonus win
              </span>
            </p>
            <Note>
              Each week you play your scheduled opponent <em>and</em> the league median score. Win
              both for 2-0, split for 1-1. Records are out of{" "}
              <strong className="text-foreground">double</strong> the games. Half of each record is
              still your real opponent, so this <em>halves</em> schedule luck rather than removing
              it — All-Play below removes it entirely.
            </Note>
            <StandingsTable rows={ws.median} actual={actual} pf recordLabel="Median Record" />
          </section>

          {ws.schedule_luck?.length ? (
            <section id="sec-schedule" className="scroll-mt-6">
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Schedule Luck{" "}
                <span className="font-sans normal-case tracking-normal">
                  — the same scores, everyone else&apos;s schedule
                </span>
              </p>
              <Note>
                Your exact weekly scores replayed against all 11 other schedules, without changing a
                single lineup. <strong className="text-foreground">Best</strong> and{" "}
                <strong className="text-foreground">worst</strong> are the kindest and cruellest
                draws you could have had; <strong className="text-foreground">Luck</strong> is your
                real win total minus the median across every schedule — positive means the schedule
                did you a favour.
              </Note>
              <ScheduleLuck rows={ws.schedule_luck} />
            </section>
          ) : null}

          <section id="sec-allplay" className="scroll-mt-6">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              All-Play Record{" "}
              <span className="font-sans normal-case tracking-normal">
                — each week vs the entire league
              </span>
            </p>
            <Note>
              Every week you play <em>all</em> other teams at once — a win for each team you
              outscore. This strips out schedule luck entirely, so it&apos;s the fairest read on
              week-to-week scoring.
            </Note>
            <StandingsTable rows={ws.all_play} actual={actual} pf />
          </section>

          <section id="sec-bestball" className="scroll-mt-6">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Best Ball{" "}
              <span className="font-sans normal-case tracking-normal">— optimal lineup every week</span>
            </p>
            <Note>
              Standings if every manager auto-started their{" "}
              <strong className="text-foreground">optimal</strong> lineup each week, using real
              per-player league scoring, replayed against the actual schedule. Pure roster strength —
              the gap vs actual is start/sit skill (or luck).
            </Note>
            <StandingsTable rows={ws.best_ball} actual={actual} pf />
          </section>

          <Seeding ws={ws} />
        </div>
      )}
    </div>
  );
}
