"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchJSON, relTime,
  type BestAvailable, type Ecr, type EcrAvailable, type FreeAgent, type Meta,
  type TrendingPlayer, type Waivers,
} from "@/lib/data";
import { Headshot, PlayerLink, PosPill, PageHeader } from "@/components/gggg/primitives";
import { Segmented } from "@/components/gggg/segmented";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

type SortKey = "proj" | "ecr" | "ppg";

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

/* ── Free-agent board ──────────────────────────────────────────────────────
   The old section showed a top-8-per-position teaser ranked on last season's
   totals. This is every unrostered player the projection feed covers, ranked
   by what he would actually score US — the builder re-scores defenses from
   their raw projected stat line with the league's own settings, so a DEF's
   number here is directly comparable to the skill players above it, which it
   was not while both sides read Sleeper's default PPR. */
function FreeAgentBoard({
  rows, ecr, week, season, ppgSeason,
}: {
  rows: FreeAgent[];
  ecr: Ecr | null;
  week?: number | null;
  season?: string | null;
  /** Season the PPG column is drawn from — the previous one until games are
      played, which is the whole of Week 1. */
  ppgSeason?: string | null;
}) {
  const [pos, setPos] = useState<string>("ALL");
  const [sort, setSort] = useState<SortKey>("proj");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(false);

  /* Consensus rank by pid, when ffpros has run. Used as a sort key and a
     column; the board never depends on it. */
  const ecrByPid = useMemo(() => {
    const m = new Map<string, EcrAvailable>();
    Object.values(ecr?.available ?? {}).forEach((list) =>
      (list ?? []).forEach((a) => m.set(String(a.pid), a)),
    );
    return m;
  }, [ecr]);
  const hasEcr = ecrByPid.size > 0;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (pos === "ALL" || r.pos === pos) &&
        (!needle ||
          r.player.toLowerCase().includes(needle) ||
          (r.nfl_team ?? "").toLowerCase().includes(needle)),
    );
    const rank = (r: FreeAgent) => ecrByPid.get(String(r.pid))?.ecr ?? Infinity;
    if (sort === "ecr") out.sort((a, b) => rank(a) - rank(b) || b.proj - a.proj);
    else if (sort === "ppg") out.sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0));
    else out.sort((a, b) => b.proj - a.proj);
    return out;
  }, [rows, pos, q, sort, ecrByPid]);

  /* Long lists are the point of this section, but 290 rows on a phone is not a
     useful first screen. Show a page, then let the reader ask for the rest. */
  const PAGE = 25;
  const shown = expanded ? filtered : filtered.slice(0, PAGE);

  const ppgLabel = ppgSeason ? `${ppgSeason} PPG` : "PPG";
  const sortOptions: readonly (readonly [SortKey, string])[] = hasEcr
    ? ([["proj", "Projected"], ["ecr", "Consensus"], ["ppg", ppgLabel]] as const)
    : ([["proj", "Projected"], ["ppg", ppgLabel]] as const);

  return (
    <section className="mb-10">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
        Free Agents{" "}
        <span className="font-sans normal-case tracking-normal">
          — all {rows.length} unrostered players
          {week ? `, projected for Week ${week} under our scoring` : ""}
        </span>
      </p>

      <Segmented label="Position" options={POSITIONS} value={pos} onChange={setPos} />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Segmented<SortKey>
          label="Sort by"
          options={sortOptions}
          value={sort}
          onChange={setSort}
          className="mb-0 sm:w-auto"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search player or team…"
          aria-label="Search free agents"
          className="min-h-9 w-full rounded-lg border bg-card px-3 py-1.5 text-base sm:flex-1 sm:text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        {/* The projection is the reason to look at this table, so on a phone the
            row number goes rather than let Proj fall off the right edge. */}
        <table className="w-full min-w-[320px] text-sm sm:min-w-[460px]">
          <thead>
            <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="hidden w-8 px-2 py-1.5 text-left sm:table-cell sm:w-10 sm:px-3 sm:py-2">#</th>
              <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Player</th>
              <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Pos</th>
              <th className="hidden px-2 py-1.5 text-left sm:table-cell sm:px-3 sm:py-2">Opp</th>
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Proj</th>
              {hasEcr && (
                <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">Rank</th>
              )}
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">{ppgLabel}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a, i) => {
              const rank = ecrByPid.get(String(a.pid));
              return (
                <tr key={a.pid} className="border-b last:border-0">
                  <td className="hidden px-2 py-1.5 font-mono text-muted-foreground sm:table-cell sm:px-3 sm:py-2">
                    {i + 1}
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    <div className="flex items-center gap-2">
                      <Headshot pid={a.pid} pos={a.pos} nflTeam={a.nfl_team} />
                      <div className="min-w-0">
                        <div className="truncate font-bold">
                          <PlayerLink pid={a.pid}>{a.player}</PlayerLink>
                          <InjuryBadge injury={a.injury} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {a.nfl_team}
                          <span className="sm:hidden">{a.opp ? ` · ${a.opp}` : ""}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    <PosPill pos={a.pos} />
                  </td>
                  <td className="hidden px-2 py-1.5 font-mono text-xs text-muted-foreground sm:table-cell sm:px-3 sm:py-2">
                    {a.opp || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums sm:px-3 sm:py-2">
                    {a.proj.toFixed(1)}
                  </td>
                  {hasEcr && (
                    <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                      {rank?.pos_rank ?? "—"}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground sm:px-3 sm:py-2">
                    {(a.ppg ?? 0).toFixed(1)}
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={hasEcr ? 7 : 6} className="px-3 py-4 text-center text-muted-foreground">
                  No free agents match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full rounded-lg border bg-card px-3 py-2 font-mono text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {expanded ? "Show fewer" : `Show all ${filtered.length}`}
        </button>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Projections are {season ? `${season} ` : ""}Week {week ?? "—"} scored with this league&apos;s
        own settings. Defenses are computed from their projected stat line — points and yards
        allowed land in whichever tier the projection falls in, and three-and-outs and fourth-down
        stops are not projected at all, so a DEF number runs a little low.
      </p>
    </section>
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

          {w.free_agents?.length ? (
            <FreeAgentBoard
              rows={w.free_agents}
              ecr={ecr}
              week={w.proj_week}
              season={w.proj_season}
              ppgSeason={w.ppg_season}
            />
          ) : (
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
          )}

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
