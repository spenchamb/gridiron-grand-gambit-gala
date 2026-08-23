"use client";

import { useEffect, useState } from "react";
import { fetchJSON, relTime, type Meta, type WhatIf, type WiRow, type WiSeason } from "@/lib/data";
import { PageHeader, Note } from "@/components/gggg/primitives";
import { cn } from "@/lib/utils";

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
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-10 px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Team</th>
            <th className="px-3 py-2 text-right">{recordLabel}</th>
            {pf && <th className="px-3 py-2 text-right">PF</th>}
            <th className="px-3 py-2 text-right">vs Actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team} className="border-b last:border-0">
              <td className="px-3 py-2 font-mono text-muted-foreground">{r.rank}</td>
              <td className="px-3 py-2 font-bold">{r.team}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{r.record}</td>
              {pf && (
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {(r.pf ?? 0).toFixed(0)}
                </td>
              )}
              <td className="px-3 py-2 text-right font-mono">
                <Delta actual={actual.get(r.team)} rank={r.rank} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniStandings({ title, rows, actual }: { title: string; rows: WiRow[]; actual: Map<string, number> }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.13em] text-primary">
        {title}
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.team}>
              <td className="py-1.5 pr-2 font-mono text-muted-foreground">{r.rank}</td>
              <td className="py-1.5 pr-2 font-bold">{r.team}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{r.record}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                {(r.pf ?? 0).toFixed(0)}
              </td>
              <td className="py-1.5 text-right font-mono">
                <Delta actual={actual.get(r.team)} rank={r.rank} />
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
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">By&nbsp;Record</th>
              <th className="px-3 py-2 text-left">Team</th>
              <th className="px-3 py-2 text-right">Record</th>
              <th className="px-3 py-2 text-right">PF</th>
              <th className="px-3 py-2 text-right">League Seed</th>
              <th className="px-3 py-2 text-right">Δ</th>
              <th className="px-3 py-2 text-right">Status</th>
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
                  <td className="px-3 py-2 font-mono text-muted-foreground">{r.record_seed}</td>
                  <td className="px-3 py-2">
                    <span className="font-bold">{r.team}</span>
                    {r.div_winner && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">◆ div winner</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{r.record}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {r.pf.toFixed(0)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    #{r.actual_seed}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {d > 0 ? (
                      <span className="font-bold text-ok">▲ {d}</span>
                    ) : d < 0 ? (
                      <span className="font-bold text-bad">▼ {-d}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
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
        <span>By Record = seed if seeded purely on record · League Seed = actual</span>
        <span>Δ ▲ = climbs under record seeding · ◆ = division winner</span>
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
    <main className="mx-auto w-full max-w-4xl px-6 pb-20 pt-10">
      <PageHeader
        eyebrow="Alternate Realities"
        title="What-If"
        subtitle={error ? "Could not load what-if data." : "Re-run each season under different rules."}
        updated={updated}
      />

      {wi && (
        <div className="mb-8 flex flex-wrap gap-1.5">
          {wi.seasons.map((s, idx) => (
            <button
              key={s.season}
              type="button"
              onClick={() => setI(idx)}
              className={cn(
                "rounded-md border px-3 py-1 font-mono text-xs font-bold transition-colors",
                idx === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {s.season} Season
            </button>
          ))}
        </div>
      )}

      {!wi && !error && <div className="h-64 animate-pulse rounded-lg border bg-card" />}

      {ws && (
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
              recorded scoring exactly (to the point);{" "}
              <strong className="text-foreground">half PPR</strong> and{" "}
              <strong className="text-foreground">standard</strong> then remove 0.5 and 1.0 points
              per reception, using the lineups each manager actually started. Regular season only.
            </Note>
            <div className="grid gap-3 lg:grid-cols-3">
              <MiniStandings title="Full PPR" rows={ws.scoring.ppr} actual={actual} />
              <MiniStandings title="Half PPR" rows={ws.scoring.half} actual={actual} />
              <MiniStandings title="Standard" rows={ws.scoring.std} actual={actual} />
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
              both for 2-0, split for 1-1. Rewards consistent scoring and removes schedule luck.
              Records are out of <strong className="text-foreground">double</strong> the games.
            </Note>
            <StandingsTable rows={ws.median} actual={actual} pf recordLabel="Median Record" />
          </section>

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
    </main>
  );
}
