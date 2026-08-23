"use client";

import { useEffect, useState } from "react";
import { fetchJSON, relTime, type Meta, type Recap } from "@/lib/data";
import { Headshot, StatCard, PageHeader, Note } from "@/components/gggg/primitives";
import { cn } from "@/lib/utils";

export default function RecapPage() {
  const [r, setR] = useState<Recap | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([fetchJSON<Recap>("recap.json"), fetchJSON<Meta>("meta.json")])
      .then(([rr, m]) => {
        setR(rr);
        setMeta(m);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
      })
      .catch(() => setError(true));
  }, []);

  const live = meta?.is_live ?? false;

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Weekly Recap" title="Last Week" subtitle="Could not load recap." />
      </div>
    );
  }

  /* Empty state — no completed week yet. This is the live state today
     (recap.json is {has_data:false}), so it is the branch actually verified
     against production data. */
  if (r && !r.has_data) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow="Weekly Recap"
          title="Last Week"
          subtitle={
            live
              ? "No games have been played yet this season — check back after Week 1."
              : "No completed week to recap yet."
          }
          updated={updated}
        />
        <Note>
          The new season hasn&apos;t kicked off. Once Week 1 is in the books, this page fills with
          the week&apos;s biggest scores, closest games, lucky/unlucky teams, and top performers.
        </Note>
      </div>
    );
  }

  if (!r) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Weekly Recap" title="Last Week" subtitle="Loading…" />
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  const games = r.games ?? [];
  const median = r.median ?? 0;
  const phase = r.is_regular ? `Week ${r.week}` : `Playoffs · Week ${r.week}`;

  const hero: [string, string, string][] = [];
  if (r.high) hero.push(["Top Score", r.high.pts.toFixed(1), r.high.team]);
  if (r.low) hero.push(["Low Score", r.low.pts.toFixed(1), r.low.team]);
  if (r.blowout)
    hero.push([
      "Biggest Blowout",
      `+${r.blowout.margin.toFixed(1)}`,
      `${r.blowout.winner ?? r.blowout.t1} over ${
        r.blowout.winner === r.blowout.t1 ? r.blowout.t2 : r.blowout.t1
      }`,
    ]);
  if (r.nailbiter)
    hero.push(["Closest Game", r.nailbiter.margin.toFixed(2), `${r.nailbiter.winner} by a hair`]);

  const luck: [string, string, string][] = [];
  if (r.unlucky)
    luck.push(["Unlucky", r.unlucky.pts.toFixed(1), `${r.unlucky.team} — most points in a loss`]);
  if (r.lucky)
    luck.push(["Lucky", r.lucky.pts.toFixed(1), `${r.lucky.team} — fewest points in a win`]);
  luck.push([
    "Beat the Median",
    `${(r.above_median ?? []).length}/${games.length * 2}`,
    `scored above ${median.toFixed(1)}`,
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow={
          live
            ? `${r.season} · In Progress`
            : `${r.season} · ${r.is_regular ? "Regular Season" : "Final Week"}`
        }
        title={live ? `${phase} Recap` : r.is_regular ? `Week ${r.week} Recap` : "Championship Week"}
        subtitle={`${games.length} matchup${games.length > 1 ? "s" : ""} · league median ${median.toFixed(
          1,
        )}${r.high && r.low ? ` · high ${r.high.pts.toFixed(1)}, low ${r.low.pts.toFixed(1)}` : ""}`}
        updated={updated}
      />

      <section className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {hero.map(([l, v, s]) => (
          <StatCard key={l} label={l} value={v} sub={s} accent />
        ))}
      </section>

      <section className="mb-10">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Luck of the Week
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {luck.map(([l, v, s]) => (
            <StatCard key={l} label={l} value={v} sub={s} />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Scoreboard
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {games.map((g, i) => {
            const row = (team: string, pts: number, won: boolean) => (
              <div
                className={cn(
                  "flex items-center justify-between gap-3",
                  !won && "text-muted-foreground",
                )}
              >
                <span className="truncate">{team}</span>
                <span className={cn("font-mono font-bold tabular-nums", won && "text-ok")}>
                  {pts.toFixed(1)}
                </span>
              </div>
            );
            return (
              <div key={i} className="rounded-lg border bg-card px-4 py-3 text-sm">
                {row(g.t1, g.t1_pts, g.winner === g.t1)}
                {row(g.t2, g.t2_pts, g.winner === g.t2)}
                <div className="mt-1.5 text-right text-[11px] text-muted-foreground">
                  {g.winner ? `margin ${g.margin.toFixed(1)}` : "tie"} · total {g.total.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Top Performers{" "}
          <span className="font-sans normal-case tracking-normal">
            — best fantasy starters this week
          </span>
        </p>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Player</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Started By</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Pts</th>
              </tr>
            </thead>
            <tbody>
              {(r.top_players ?? []).map((p, i) => (
                <tr key={`${p.pid}-${i}`} className="border-b last:border-0">
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    <div className="flex items-center gap-2">
                      <Headshot pid={p.pid} pos={p.pos} nflTeam={p.nfl_team} />
                      <div className="min-w-0">
                        <div className="truncate font-bold">{p.player}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.pos} · {p.nfl_team}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-muted-foreground">{p.fantasy_team}</td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono font-bold tabular-nums">
                    {p.pts.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
