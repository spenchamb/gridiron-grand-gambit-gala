"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchJSON, relTime,
  type BestAvailable, type Ecr, type Meta, type TrendingPlayer, type Waivers,
} from "@/lib/data";
import { Headshot, PlayerLink, PosPill, PageHeader } from "@/components/gggg/primitives";
import { Segmented } from "@/components/gggg/segmented";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function InjuryBadge({ injury }: { injury?: string }) {
  if (!injury) return null;
  const map: Record<string, string> = {
    Out: "O", IR: "IR", Doubtful: "D", Questionable: "Q", PUP: "PUP", Sus: "SUS",
  };
  return (
    <span className="ml-1 rounded-sm bg-bad/20 px-1 font-mono text-[9px] font-bold text-bad">
      {map[injury] ?? injury.slice(0, 3).toUpperCase()}
    </span>
  );
}

function TrendRow({ t }: { t: TrendingPlayer }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 last:border-0">
      <Headshot pid={t.pid} pos={t.pos} nflTeam={t.nfl_team} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          <PlayerLink pid={t.pid}><strong>{t.player}</strong></PlayerLink>
          <InjuryBadge injury={t.injury} />
          <span className="text-muted-foreground">
            {" "}
            {t.pos} · {t.nfl_team}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {(t.count ?? 0).toLocaleString()} moves ·{" "}
          {t.rostered_by ? `rostered by ${t.rostered_by}` : <span className="text-ok">available</span>}
        </div>
      </div>
    </div>
  );
}

export default function WaiversPage() {
  const [w, setW] = useState<Waivers | null>(null);
  const [ecr, setEcr] = useState<Ecr | null>(null);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);
  const [pos, setPos] = useState<string>("ALL");

  useEffect(() => {
    Promise.all([fetchJSON<Waivers>("waivers.json"), fetchJSON<Meta>("meta.json")])
      .then(([ww, m]) => {
        setW(ww);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
      })
      .catch(() => setError(true));
    /* ECR is optional — the page still works if ffpros hasn't run yet. */
    fetchJSON<Ecr>("ecr.json").then(setEcr).catch(() => setEcr(null));
  }, []);

  /* Last-season PPG lookup by pid, seeded from Sleeper's own lists. Used as a
     secondary signal next to consensus ranks. */
  const ppg = useMemo(() => {
    const m = new Map<string, BestAvailable>();
    const seed = (arr?: BestAvailable[]) =>
      (arr ?? []).forEach((a) => {
        if (a.pid != null) m.set(String(a.pid), a);
      });
    seed(w?.best_overall);
    Object.values(w?.best_available ?? {}).forEach(seed);
    return m;
  }, [w]);

  const useEcr = Boolean(ecr?.available?.[pos]?.length);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Free Agency" title="Waiver Wire" subtitle="Could not load waiver data." />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow={w ? `Free Agency · ${w.season}` : "Free Agency"}
        title="Waiver Wire"
        subtitle={
          w
            ? `${w.season} · ${w.is_faab ? `FAAB · $${w.budget} budget` : "Reverse-standings priority"}`
            : "Loading…"
        }
        updated={updated}
      />

      {!w && <div className="h-64 animate-pulse rounded-lg border bg-card" />}

      {w && (
        <>
          <section className="mb-10">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {w.is_faab ? "FAAB Budgets" : "Waiver Priority"}
            </p>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <tbody>
                  {w.order.map((o, i) => (
                    <tr key={o.owner_id || i} className="border-b last:border-0">
                      {!w.is_faab && (
                        <td className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 font-mono text-muted-foreground">
                          {o.position ?? i + 1}
                        </td>
                      )}
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: o.color ?? "var(--muted-foreground)" }}
                          />
                          <span className="font-bold">{o.team}</span>
                        </div>
                        {!w.is_faab && (
                          <div className="pl-5 text-xs text-muted-foreground">{o.owner}</div>
                        )}
                      </td>
                      {w.is_faab && (
                        <>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                            ${o.faab_left}
                            <span className="text-muted-foreground"> / {o.faab_total}</span>
                          </td>
                          <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                            <span className="block h-2 w-full min-w-[80px] overflow-hidden rounded-sm bg-secondary">
                              <span
                                className="block h-full"
                                style={{
                                  width: `${o.faab_total ? Math.round(((o.faab_left ?? 0) / o.faab_total) * 100) : 0}%`,
                                  background: o.color ?? "var(--ok)",
                                }}
                              />
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-10">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Trending{" "}
              <span className="font-sans normal-case tracking-normal">
                — most added &amp; dropped across Sleeper (24h)
              </span>
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-bold">🔼 Most Added</p>
                <div className="rounded-lg border bg-card">
                  {w.trending_add.length ? (
                    w.trending_add.map((t) => <TrendRow key={t.pid} t={t} />)
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-bold">🔽 Most Dropped</p>
                <div className="rounded-lg border bg-card">
                  {w.trending_drop.length ? (
                    w.trending_drop.map((t) => <TrendRow key={t.pid} t={t} />)
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="mb-10">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Best Available{" "}
              <span className="font-sans normal-case tracking-normal">
                {useEcr
                  ? `— top unrostered by ${ecr!.mode === "ros" ? "rest-of-season" : "preseason"} consensus (PPR)`
                  : "— top unrostered scorers by position (season PPR)"}
              </span>
            </p>

            <Segmented label="Position" options={POSITIONS} value={pos} onChange={setPos} />

            <div className="overflow-x-auto rounded-lg border bg-card">
              {useEcr ? (
                <table className="w-full min-w-[460px] text-sm">
                  <thead>
                    <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Player</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Pos</th>
                      <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">ECR</th>
                      <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">Pos</th>
                      <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">Ros%</th>
                      <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">PPG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ecr!.available[pos].map((a, i) => {
                      const seed = ppg.get(String(a.pid));
                      const nflTeam = a.team && a.team !== "FA" ? a.team : seed?.nfl_team ?? "";
                      return (
                        <tr key={`${a.pid}-${i}`} className="border-b last:border-0">
                          <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                            <div className="flex items-center gap-2">
                              <Headshot pid={a.pid} pos={a.pos} nflTeam={nflTeam} />
                              <div className="min-w-0">
                                <div className="truncate font-bold">
                                  <PlayerLink pid={a.pid}>{a.name}</PlayerLink>
                                  <InjuryBadge injury={a.injury} />
                                </div>
                                <div className="text-xs text-muted-foreground">{nflTeam}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                            <PosPill pos={a.pos} />
                          </td>
                          <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono font-bold tabular-nums">
                            {a.ecr ?? "—"}
                          </td>
                          <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                            {a.pos_rank ?? ""}
                          </td>
                          <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                            {a.owned != null ? `${Math.round(a.owned)}%` : "—"}
                          </td>
                          <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {seed ? (seed.ppg ?? 0).toFixed(1) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Player</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Pos</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Season PPR</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">PPG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pos === "ALL" ? w.best_overall : w.best_available[pos] ?? []).map((a, i) => (
                      <tr key={`${a.pid}-${i}`} className="border-b last:border-0">
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <div className="flex items-center gap-2">
                            <Headshot pid={a.pid} pos={a.pos} nflTeam={a.nfl_team} />
                            <div className="min-w-0">
                              <div className="truncate font-bold">
                                <PlayerLink pid={a.pid}>{a.player}</PlayerLink>
                                <InjuryBadge injury={a.injury} />
                              </div>
                              <div className="text-xs text-muted-foreground">{a.nfl_team}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <PosPill pos={a.pos} />
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono font-bold tabular-nums">
                          {(a.pts_ppr ?? 0).toFixed(1)}
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {(a.ppg ?? 0).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Recent Pickups &amp; Drops
            </p>
            <div className="rounded-lg border bg-card">
              {w.recent_moves.length ? (
                w.recent_moves.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 border-b px-3 py-2 last:border-0">
                    <span className="mt-0.5 rounded-sm bg-secondary px-1.5 py-px font-mono text-[9px] font-bold uppercase text-muted-foreground">
                      {t.type === "free_agent" ? "FA" : t.type}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <div>
                        {t.team} <span className="text-ok">+ {t.add}</span>{" "}
                        <span className="text-muted-foreground">
                          ({t.add_pos}
                          {t.add_team ? ` · ${t.add_team}` : ""})
                        </span>
                        {t.drop && <span className="text-bad"> − {t.drop}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{fmtDate(t.created)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">No recent moves.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
