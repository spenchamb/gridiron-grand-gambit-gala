"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fetchJSON, relTime,
  type Meta, type ProjTeam, type Projections,
} from "@/lib/data";
import { Headshot, MINE_ROW, PosPill, PageHeader, YouBadge } from "@/components/gggg/primitives";
import { isMine, useMe } from "@/lib/me";
import { cn } from "@/lib/utils";

/* These percentages arrive already scaled 0–100, not 0–1. */
const pctTxt = (v: number) => (v >= 99.5 ? ">99" : v < 0.5 && v > 0 ? "<1" : Math.round(v)) + "%";

/** Red → green ramp for the win-probability strip and the positional grid. */
const heat = (p: number) => {
  const t = Math.max(0, Math.min(1, p));
  const a = [122, 58, 52];
  const b = [47, 125, 91];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
};

const ordSuffix = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n % 100 >= 11 && n % 100 <= 13
      ? `${n}th`
      : n + (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");

function TeamDetail({ t, slots }: { t: ProjTeam; slots: string[] }) {
  const hist = Object.entries(t.wins_hist).sort((a, b) => +a[0] - +b[0]);
  const hmax = Math.max(...hist.map(([, p]) => p));
  return (
    <td colSpan={10} className="bg-background/40 px-4 py-4">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <Key>Wins distribution</Key>
          <div className="mt-1 flex h-12 items-end gap-0.5">
            {hist.map(([w, p]) => (
              <i
                key={w}
                title={`${w} wins — ${(p * 100).toFixed(1)}%`}
                className={cn("flex-1 rounded-sm", +w === Math.round(t.w50) ? "bg-primary" : "bg-secondary")}
                style={{ height: `${Math.max(2, (p / hmax) * 44)}px` }}
              />
            ))}
          </div>
          <div className="mt-0.5 flex gap-0.5 font-mono text-[9px] text-muted-foreground">
            {hist.map(([w]) => (
              <span key={w} className="flex-1 text-center">
                {w}
              </span>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <Key>Carrying the load</Key>
          <div className="mt-1 text-sm">
            {t.core.map((c, i) => (
              <span key={c.pid}>
                {i > 0 && " · "}
                <Link
                  href={{ pathname: "/player", query: { pid: c.pid } }}
                  className="hover:text-primary"
                >
                  {c.name}
                </Link>{" "}
                <span className="text-muted-foreground">{c.lineup}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <Key>Points per week by slot</Key>
          <div className="mt-1 text-sm">
            {slots.map((s, i) => (
              <span key={s}>
                {i > 0 && " · "}
                {s} <b>{(t.slots[s] ?? 0).toFixed(1)}</b>{" "}
                <span className="text-muted-foreground">({ordSuffix(t.slot_rank[s])})</span>
              </span>
            ))}
          </div>
        </div>

        <Fact k="Points for">
          <b>{t.exp_pf}</b>{" "}
          <span className="text-muted-foreground">
            ({t.pf10}–{t.pf90})
          </span>
        </Fact>
        <Fact k="Bench points/wk">
          <b>{t.bench_ppg.toFixed(1)}</b>
        </Fact>
        <Fact k="Unfillable starts">
          <b>{t.gaps.toFixed(2)}</b> <span className="text-muted-foreground">a season</span>
        </Fact>
        <Fact k="Opponents average">
          <b>{t.opp_ppg.toFixed(1)}</b>/wk ({ordSuffix(t.sos_rank)} toughest)
        </Fact>
        <Fact k="Schedule worth">
          <b>
            {t.sos_delta_wins > 0 ? "+" : ""}
            {t.sos_delta_wins.toFixed(2)}
          </b>{" "}
          wins
        </Fact>
        <Fact k="First-round bye">
          <b>{pctTxt(t.bye_pct)}</b>
        </Fact>
        <Fact k="Reaches the final">
          <b>{pctTxt(t.finals_pct)}</b>
        </Fact>
        <Fact k="Leads league in points">
          <b>{pctTxt(t.pf_crown_pct)}</b>
        </Fact>
        <div className="sm:col-span-2 lg:col-span-3">
          <Key>Injury designations</Key>
          <div className="mt-1 text-sm">
            {t.injured.length ? (
              t.injured.map((p, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  {p.name} <span className="text-bad">{p.status}</span>
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">nobody flagged</span>
            )}
          </div>
        </div>
      </div>
    </td>
  );
}

const Key = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
    {children}
  </span>
);
const Fact = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div>
    <Key>{k}</Key>
    <div className="mt-0.5 text-sm">{children}</div>
  </div>
);

function ProjectionsView() {
  const params = useSearchParams();
  const me = useMe();
  const [p, setP] = useState<Projections | null>(null);
  const [missing, setMissing] = useState(false);
  const [updated, setUpdated] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [ldPos, setLdPos] = useState("ALL");

  useEffect(() => {
    (async () => {
      let m: Meta | null = null;
      try {
        m = await fetchJSON<Meta>("meta.json");
      } catch {}
      const season = params.get("season") || m?.nfl_season || m?.seasons?.[0];
      try {
        const data = await fetchJSON<Projections>(`projections_${season}.json`);
        if (!data?.teams?.length) setMissing(true);
        else {
          setP(data);
          setUpdated(`Rebuilt ${relTime(data.generated)}`);
        }
      } catch {
        setMissing(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const positions = useMemo(
    () => (p ? ["ALL", ...Array.from(new Set(p.leaders.map((l) => l.pos)))] : []),
    [p],
  );
  const leaders = p ? (ldPos === "ALL" ? p.leaders : p.leaders.filter((l) => l.pos === ldPos)) : [];

  const gridRows = useMemo(() => {
    if (!p) return [];
    return [...p.teams].sort((a, b) => b.proj_ppg - a.proj_ppg);
  }, [p]);

  const bounds = useMemo(() => {
    if (!p) return {};
    const out: Record<string, [number, number]> = {};
    p.meta.slots.forEach((s) => {
      const vals = p.teams.map((t) => t.slots[s] ?? 0);
      out[s] = [Math.min(...vals), Math.max(...vals)];
    });
    return out;
  }, [p]);

  if (missing)
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow="Season Projections"
          title="Projections"
          subtitle="No projections yet — they appear once the season is drafted."
        />
      </div>
    );

  if (!p)
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Season Projections" title="Projections" subtitle="Loading…" />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );

  const wks = p.meta.weeks;
  const pw = p.meta.playoff_weeks;
  const n = wks.length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow={`${p.league_name ?? ""} · ${p.season} Season`}
        title={`${p.season} Projections`}
        subtitle={`${p.meta.sims.toLocaleString()} simulated seasons · weeks ${wks[0]}–${wks[n - 1]}`}
        updated={updated}
      />

      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Each team&apos;s lineup is set every week from Sleeper&apos;s latest weekly PPR projections,
        then the real schedule is played out {p.meta.sims.toLocaleString()} times. Players get hurt in
        the simulation — rate by position and age, duration drawn from a real distribution — and when
        they do, the next man up inherits the slot, which is why bench depth moves these numbers. Only
        the {p.meta.starters} starters ever score. Playoffs are the top {p.meta.playoff_teams} on
        record, weeks {pw[0]}–{pw[pw.length - 1]}. Rebuilt daily off the current rosters.
      </p>

      <section className="mb-12">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Projected Finish{" "}
          <span className="font-sans normal-case tracking-normal">
            — {p.meta.sims.toLocaleString()} simulations
          </span>
        </p>
        {/* Ten columns and the widest table in the app. A phone gets the four
            that answer "where do I finish" — rank, team, projected record,
            playoff odds — and the row already taps open for the rest. */}
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[340px] text-sm">
            <thead>
              <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-8 px-2 py-1.5 text-left sm:w-10 sm:px-3 sm:py-2">#</th>
                <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Team</th>
                <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Proj</th>
                <th className="hidden px-2 py-1.5 text-left md:table-cell sm:px-3 sm:py-2">Range</th>
                <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">Pts/wk</th>
                <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Playoffs</th>
                <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">Title</th>
                <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">Last</th>
                <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">SoS</th>
                <th className="hidden px-2 py-1.5 text-left md:table-cell sm:px-3 sm:py-2">
                  Weeks {wks[0]}–{wks[n - 1]}
                </th>
              </tr>
            </thead>
            <tbody>
              {p.teams.map((t, i) => (
                <Fragment key={t.roster_id}>
                  <tr
                    onClick={() => setOpen(open === i ? null : i)}
                    className={cn(
                      "cursor-pointer border-b last:border-0 hover:bg-accent/40",
                      isMine(me, t.owner_id) && MINE_ROW,
                    )}
                  >
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                      <div className="flex items-center font-bold">
                        {t.team}
                        {isMine(me, t.owner_id) && <YouBadge />}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{t.owner}</div>
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                      {t.exp_wins.toFixed(1)}–{t.exp_losses.toFixed(1)}
                    </td>
                    <td className="hidden px-2 py-1.5 md:table-cell sm:px-3 sm:py-2">
                      {/* 10th–90th band with the interquartile range inside it. */}
                      <div
                        className="relative h-4 w-28 rounded-sm bg-secondary"
                        title={`10th–90th percentile: ${t.w10}–${t.w90} wins`}
                      >
                        <i
                          className="absolute inset-y-0 rounded-sm bg-primary/20"
                          style={{ left: `${(t.w10 / n) * 100}%`, width: `${((t.w90 - t.w10) / n) * 100}%` }}
                        />
                        <i
                          className="absolute inset-y-0 rounded-sm bg-primary/50"
                          style={{ left: `${(t.w25 / n) * 100}%`, width: `${((t.w75 - t.w25) / n) * 100}%` }}
                        />
                        <i
                          className="absolute inset-y-0 w-0.5 bg-foreground"
                          style={{ left: `calc(${(t.w50 / n) * 100}% - 1px)` }}
                        />
                        <b className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold">
                          {t.w10}–{t.w90}
                        </b>
                      </div>
                    </td>
                    <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums sm:table-cell sm:px-3 sm:py-2">
                      {t.proj_ppg.toFixed(1)}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                      {pctTxt(t.playoff_pct)}
                    </td>
                    <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums sm:table-cell sm:px-3 sm:py-2">
                      {pctTxt(t.title_pct)}
                    </td>
                    <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                      {pctTxt(t.last_pct)}
                    </td>
                    <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                      {t.sos_rank}
                    </td>
                    <td className="hidden px-2 py-1.5 md:table-cell sm:px-3 sm:py-2">
                      <div className="flex gap-px">
                        {t.weeks.map((w) => (
                          <span
                            key={w.week}
                            title={
                              w.win_pct == null
                                ? undefined
                                : `Wk ${w.week} vs ${w.opp ?? ""} — ${Math.round(w.win_pct * 100)}%`
                            }
                            className="h-4 w-2 rounded-[1px]"
                            style={{
                              background: w.win_pct == null ? "transparent" : heat(w.win_pct),
                            }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                  {open === i && (
                    <tr className="border-b">
                      <TeamDetail t={t} slots={p.meta.slots} />
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Tap a team for detail.</p>
      </section>

      <section className="mb-12">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Positional Strength{" "}
          <span className="font-sans normal-case tracking-normal">
            — projected points per week by lineup slot
          </span>
        </p>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Team</th>
                {p.meta.slots.map((s) => (
                  <th key={s} className="px-2 py-1.5 text-right sm:px-3 sm:py-2">
                    {s}
                  </th>
                ))}
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.map((t) => (
                <tr key={t.roster_id} className="border-b last:border-0">
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-bold">{t.team}</td>
                  {p.meta.slots.map((s) => {
                    const v = t.slots[s] ?? 0;
                    const [lo, hi] = bounds[s] ?? [0, 1];
                    const span = hi - lo || 1;
                    return (
                      <td
                        key={s}
                        className="px-2 py-1.5 text-right font-mono tabular-nums text-white sm:px-3 sm:py-2"
                        style={{ background: heat((v - lo) / span) }}
                        title={`${t.team} — ${s}: ${v.toFixed(1)}/wk, ${ordSuffix(t.slot_rank[s])}`}
                      >
                        {v.toFixed(1)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono font-bold tabular-nums">
                    {t.proj_ppg.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Top Projected Players{" "}
          <span className="font-sans normal-case tracking-normal">
            — top {p.leaders.length} in the league
          </span>
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {positions.map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => setLdPos(pos)}
              className={cn(
                "rounded-md border px-2.5 py-1 font-mono text-xs font-bold transition-colors",
                ldPos === pos ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {pos}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Player</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Pos</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Team</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Proj</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Pts/wk</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Lineup</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Load</th>
                <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Bye</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((l, i) => (
                <tr key={l.pid} className="border-b last:border-0">
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    <div className="flex items-center gap-2">
                      <Headshot pid={l.pid} pos={l.pos} nflTeam={l.nfl_team} />
                      <div className="min-w-0">
                        <div className="truncate font-bold">
                          <Link
                            href={{ pathname: "/player", query: { pid: l.pid } }}
                            className="hover:text-primary"
                          >
                            {l.name}
                          </Link>
                          {l.injury && <span className="ml-1 text-[11px] text-bad">{l.injury}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{l.nfl_team}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    <PosPill pos={l.pos} />{" "}
                    <span className="text-[11px] text-muted-foreground">{l.pos_rank}</span>
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    <Link
                      href={{ pathname: "/team", query: { owner: l.owner_id } }}
                      className="font-bold hover:text-primary"
                    >
                      {l.team}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">{l.proj}</td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {l.ppg.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">{l.lineup}</td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {l.share.toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {l.bye ?? "—"}
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

export default function ProjectionsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
          <div className="h-64 animate-pulse rounded-lg border bg-card" />
        </div>
      }
    >
      <ProjectionsView />
    </Suspense>
  );
}
