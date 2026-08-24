"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fetchJSON, relTime,
  type DraftFile, type DraftKeeper, type DraftPick,
  type EcrBoardRow, type EcrFull, type Meta, type Outlook, type OutlookMarketPick,
} from "@/lib/data";
import { Headshot, PlayerLink, PosPill, PageHeader } from "@/components/gggg/primitives";
import { Segmented } from "@/components/gggg/segmented";
import { cn } from "@/lib/utils";

const ordSuffix = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n % 100 >= 11 && n % 100 <= 13
      ? `${n}th`
      : n + (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

/** Left border colour per position on a board cell — mirrors .bl-<pos>. */
const POS_BORDER: Record<string, string> = {
  QB: "border-l-bad", RB: "border-l-ok", WR: "border-l-primary",
  TE: "border-l-warn", K: "border-l-info", DEF: "border-l-muted-foreground",
};

const Signed = ({ v, unit }: { v: number; unit: string }) => (
  <span className={v > 0 ? "text-ok" : v < 0 ? "text-bad" : "text-muted-foreground"}>
    {v > 0 ? "+" : ""}
    {v.toFixed(0)}
    {unit}
  </span>
);

/* ── The snake board: keepers row, then the drafted rounds ──────────────── */
function Board({ d }: { d: DraftFile }) {
  const keepers = d.keepers ?? [];
  const slotTeam: Record<number, string> = {};
  keepers.forEach((k) => (slotTeam[k.draft_slot] = k.team));
  (d.by_round[0] ?? []).forEach((p) => {
    if (!(p.draft_slot in slotTeam)) slotTeam[p.draft_slot] = p.team;
  });
  const teams = d.meta.teams || Math.max(0, ...Object.keys(slotTeam).map(Number));
  if (!teams) return <p className="text-sm text-muted-foreground">No board.</p>;

  const kBySlot: Record<number, DraftKeeper> = {};
  keepers.forEach((k) => (kBySlot[k.draft_slot] = k));
  const nrounds = d.by_round?.length || d.meta.rounds || 0;

  const Cell = ({ p, keeper }: { p?: DraftPick; keeper?: DraftKeeper }) => {
    const item = p ?? keeper;
    if (!item) return <div />;
    return (
      <div
        className={cn(
          "min-w-0 border-l-4 bg-card px-2 py-1.5",
          POS_BORDER[item.pos] ?? "border-l-border",
        )}
      >
        <div
          className={cn(
            "font-mono text-[9px] font-bold uppercase tracking-wider",
            keeper ? "text-primary" : "text-muted-foreground",
          )}
        >
          {keeper ? "Keeper" : (p as DraftPick).pick}
        </div>
        <div className="truncate text-xs font-bold">
          <PlayerLink pid={item.pid}>{item.player}</PlayerLink>
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {item.pos} · {item.nfl_team}
          {p?.pts_ppr ? ` · ${p.pts_ppr.toFixed(0)}` : ""}
        </div>
      </div>
    );
  };

  const Label = ({ children }: { children: React.ReactNode }) => (
    <div className="truncate px-1 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-lg border bg-card p-2">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `54px repeat(${teams}, minmax(120px, 1fr))` }}
      >
        <Label> </Label>
        {Array.from({ length: teams }, (_, i) => (
          <Label key={i}>{slotTeam[i + 1] ?? `Slot ${i + 1}`}</Label>
        ))}

        <Label>Keeper</Label>
        {Array.from({ length: teams }, (_, i) => (
          <Cell key={i} keeper={kBySlot[i + 1]} />
        ))}

        {Array.from({ length: nrounds }, (_, r) => {
          const bySlot: Record<number, DraftPick> = {};
          (d.by_round?.[r] ?? []).forEach((p) => (bySlot[p.draft_slot] = p));
          return (
            <Fragment key={r}>
              <Label>R{r + 1}</Label>
              {Array.from({ length: teams }, (_, i) => (
                <Cell key={i} p={bySlot[i + 1]} />
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}


/* ── Consensus big board (ecr.json) ─────────────────────────────────────── */
function BigBoard({ board, adpSource }: { board: EcrBoardRow[]; adpSource?: string }) {
  const [pos, setPos] = useState<string>("ALL");
  const full = pos === "ALL" ? board : board.filter((r) => r.pos === pos);
  const list = full.slice(0, 50);
  const hasADP = board.some((r) => r.adp != null);

  return (
    <>
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
        Consensus Big Board{" "}
        <span className="font-sans normal-case tracking-normal">
          — {pos === "ALL" ? "overall" : pos} · top {list.length} of {full.length}
          {adpSource ? ` · ADP from ${adpSource}` : ""}
        </span>
      </p>
      <Segmented label="Position" options={POSITIONS} value={pos} onChange={setPos} />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[400px] text-sm">
          <thead>
            <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Player</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Pos</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Pos</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Bye</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Tier</th>
              {hasADP && (
                <>
                  <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">ADP</th>
                  <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Val</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.pid} className="border-b last:border-0">
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">
                  {pos === "ALL" ? (r.ecr ?? i + 1) : i + 1}
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                  <div className="flex items-center gap-2">
                    <Headshot pid={r.pid} pos={r.pos} nflTeam={r.team} />
                    <div className="min-w-0">
                      <div className="truncate font-bold">
                        <PlayerLink pid={r.pid}>{r.name}</PlayerLink>
                      </div>
                      <div className="text-xs text-muted-foreground">{r.team ?? ""}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                  <PosPill pos={r.pos} />
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {r.pos_rank ?? ""}
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {r.bye ?? "—"}
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {r.tier ?? "—"}
                </td>
                {hasADP && (
                  <>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                      {r.adp_fmt ?? (r.adp != null ? String(r.adp) : "—")}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                      {r.value == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={
                            r.value > 0 ? "text-ok" : r.value < 0 ? "text-bad" : "text-muted-foreground"
                          }
                        >
                          {r.value > 0 ? "+" : ""}
                          {r.value}
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Draft-time outlook (outlook_<season>.json) ─────────────────────────── */
const GRADE_TONE: Record<string, string> = {
  A: "text-ok", B: "text-primary", C: "text-muted-foreground", D: "text-warn", F: "text-bad",
};

function MarketCard({ p, kind }: { p: OutlookMarketPick; kind: "adp" | "slot" }) {
  const d = p.adp_delta;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        R{p.round} · Pick {p.pick} · {p.team}
      </div>
      <div className="mt-1 font-bold">
        <PlayerLink pid={p.pid}>{p.player}</PlayerLink>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {p.pos} · {p.nfl_team ?? ""} ·{" "}
        {p.lineup > 0 ? `starts, ${p.lineup.toFixed(0)} lineup pts` : "never starts"}
        <br />
        {kind === "slot" ? (
          <>
            <Signed v={p.slot_pts ?? 0} unit=" pts" /> vs slot
          </>
        ) : (
          <>
            <Signed v={p.market_pts ?? 0} unit=" pts" /> vs market
            {d != null && ` · ${d > 0 ? `${d} picks late` : `${Math.abs(d)} picks early`}`}
          </>
        )}
      </div>
    </div>
  );
}

function OutlookSections({ o }: { o: Outlook }) {
  const top = o.teams[0];
  const byGrade = [...o.teams].sort((a, b) => b.grade_z - a.grade_z);
  return (
    <>
      <section className="mb-10">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Season Outlook{" "}
          <span className="font-sans normal-case tracking-normal">
            — {o.meta.sims.toLocaleString()} simulated seasons
          </span>
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Straight out of the draft, <strong className="text-foreground">{top.team}</strong>{" "}
          projected best — {top.exp_wins.toFixed(1)} wins and the title in{" "}
          {Math.round(top.title_pct)}% of {o.meta.sims.toLocaleString()} simulated seasons. Those
          numbers move with every trade, waiver claim and injury: the live version, with ranges and
          week-by-week detail, is on the{" "}
          <Link href="/projections" className="text-primary hover:underline">
            Season Projections
          </Link>{" "}
          page. Everything below is about the draft itself and does not change.
        </p>
      </section>

      <section className="mb-10">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Draft Grades
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byGrade.map((t) => (
            <div key={t.roster_id} className="rounded-lg border bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-[11px] uppercase tracking-[0.13em] text-muted-foreground">
                  {t.team}
                </div>
                <div className={cn("text-2xl font-extrabold leading-none", GRADE_TONE[t.grade?.[0]] ?? "")}>
                  {t.grade}
                </div>
              </div>
              <dl className="mt-2 space-y-1 text-xs">
                <Row k="Projected/wk">
                  {t.proj_ppg.toFixed(1)}{" "}
                  <span className="text-muted-foreground">({ordSuffix(t.ppg_rank)})</span>
                </Row>
                <Row k="Value vs market">
                  <Signed v={t.draft_value} unit=" pts" />
                </Row>
                <Row k="Value vs slot">
                  <Signed v={t.slot_value} unit=" pts" />
                </Row>
                <Row k="Bench/wk">{t.bench_ppg.toFixed(1)}</Row>
                <Row k="Best pick">{t.best_pick?.player ?? "—"}</Row>
              </dl>
            </div>
          ))}
        </div>
      </section>

      {(o.steals?.length ?? 0) > 0 && (
        <section className="mb-10">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Market Value
          </p>
          {[
            ["Steals", o.steals, "adp"],
            ["Reaches", o.reaches, "adp"],
            ["Value vs slot", o.value_picks, "slot"],
          ].map(([label, list, kind]) =>
            (list as OutlookMarketPick[] | undefined)?.length ? (
              <div key={label as string} className="mb-4">
                <p className="mb-2 text-sm font-bold">{label as string}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(list as OutlookMarketPick[]).map((p, i) => (
                    <MarketCard key={i} p={p} kind={kind as "adp" | "slot"} />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </section>
      )}

      {(o.facts?.length ?? 0) > 0 && (
        <section className="mb-10">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Fun Facts
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {o.facts!.map((f, i) => (
              <div key={i} className="rounded-lg border bg-card px-4 py-3">
                <div className="text-xl">{f.icon}</div>
                <div className="mt-1 font-bold">{f.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{f.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-2">
    <dt className="text-muted-foreground">{k}</dt>
    <dd className="font-bold">{children}</dd>
  </div>
);

function DraftView() {
  const params = useSearchParams();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [d, setD] = useState<DraftFile | null>(null);
  const [ecr, setEcr] = useState<EcrFull | null>(null);
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [updated, setUpdated] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      let m: Meta | null = null;
      try {
        m = await fetchJSON<Meta>("meta.json");
        setMeta(m);
        setUpdated(`Updated ${relTime(m.generated_at)}`);
      } catch {}
      const season = params.get("season") || m?.draft_seasons?.[0];
      const [df, ef, of_] = await Promise.all([
        fetchJSON<DraftFile>(season ? `draft_${season}.json` : "draft.json").catch(() => null),
        fetchJSON<EcrFull>("ecr.json").catch(() => null),
        season ? fetchJSON<Outlook>(`outlook_${season}.json`).catch(() => null) : Promise.resolve(null),
      ]);
      setD(df);
      setEcr(ef);
      setOutlook(of_?.teams?.length ? of_ : null);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("season")]);

  /* Keepers are held out of the draft. On a pre-draft page the big board drops
     them and renumbers so there are no gaps. */
  const board = useMemo(() => {
    const raw = ecr?.board ?? [];
    if (!raw.length) return [];
    if (!d?.meta?.pre_draft) return raw;
    const ks = new Set((d.keepers ?? []).map((k) => String(k.pid)));
    const posc: Record<string, number> = {};
    return raw
      .filter((r) => !ks.has(String(r.pid)))
      .sort((a, b) => (a.ecr ?? 1e9) - (b.ecr ?? 1e9))
      .map((r, i) => {
        posc[r.pos] = (posc[r.pos] ?? 0) + 1;
        return { ...r, ecr: i + 1, pos_rank: `${r.pos}${posc[r.pos]}` };
      });
  }, [ecr, d]);

  if (!loaded)
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Draft" title="Draft" subtitle="Loading…" />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );

  /* No draft file at all — fall back to the standalone consensus big board. */
  if (!d?.meta) {
    if (!board.length)
      return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
          <PageHeader eyebrow="Draft" title="Draft" subtitle="No draft for this season." />
        </div>
      );
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow={`${meta?.league_name ?? ""} · Pre-Draft Rankings`}
          title={`${ecr?.season ?? ""} Draft`}
          subtitle={`Consensus big board · PPR · ${board.length} players`}
          updated={updated}
        />
        <BigBoard board={board} adpSource={ecr?.adp_source} />
      </div>
    );
  }

  const type = d.meta.type ?? "snake";
  const typeLabel = type[0].toUpperCase() + type.slice(1);
  /* Before a snap is played every pick has 0 points, so the hindsight sections
     (steals/busts/grades by actual PPR) are noise. */
  const played = (d.picks ?? []).some((p) => (p.pts_ppr ?? 0) > 0);

  if (d.meta.pre_draft)
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow={`${meta?.league_name ?? ""} · Keepers & Big Board`}
          title={`${d.meta.season} Draft`}
          subtitle={`Keepers locked in — draft not yet held.${
            board.length ? ` Big board below excludes the ${(d.keepers ?? []).length} kept players.` : ""
          }`}
          updated={updated}
        />
        <section className="mb-10">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Draft Board
          </p>
          <Board d={d} />
        </section>
        {board.length > 0 && <BigBoard board={board} adpSource={ecr?.adp_source} />}
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow={`${meta?.league_name ?? ""} · Draft Recap`}
        title={`${d.meta.season} Draft`}
        subtitle={`${typeLabel} · ${d.meta.rounds} rounds · ${d.meta.teams} teams${
          !played && outlook ? " · projections below" : ""
        }`}
        updated={updated}
      />

      {outlook && <OutlookSections o={outlook} />}

      {played && (
        <>
          {(["steals", "busts"] as const).map((k) =>
            d[k]?.length ? (
              <section key={k} className="mb-10">
                <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {k === "steals" ? "Steals" : "Busts"}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {d[k].map((p, i) => (
                    <div key={i} className="rounded-lg border bg-card px-4 py-3">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        R{p.round} · Pick {p.pick} · {p.team}
                      </div>
                      <div className="mt-1 font-bold">
                        <PlayerLink pid={p.pid}>{p.player}</PlayerLink>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {p.pos_finish ?? p.pos} · {(p.pts_ppr ?? 0).toFixed(0)} pts ·{" "}
                        <span className={k === "steals" ? "text-ok" : "text-bad"}>
                          {k === "steals" ? "+" : ""}
                          {p.value} value
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null,
          )}

          <section className="mb-10">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Team Grades
            </p>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[400px] text-sm">
                <thead>
                  <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Team</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Total PPR</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Avg / Pick</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Picks</th>
                  </tr>
                </thead>
                <tbody>
                  {d.team_grades.map((t, i) => (
                    <tr key={t.team} className="border-b last:border-0">
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-bold">{t.team}</td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                        {t.total.toFixed(0)}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                        {t.avg.toFixed(1)}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                        {t.picks}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section>
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Draft Board
        </p>
        <Board d={d} />
      </section>
    </div>
  );
}

export default function DraftPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
          <div className="h-64 animate-pulse rounded-lg border bg-card" />
        </div>
      }
    >
      <DraftView />
    </Suspense>
  );
}
