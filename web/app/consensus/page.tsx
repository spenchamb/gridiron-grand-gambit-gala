"use client";

/* Consensus Rankings — weekly PPR start/sit ranks, one position at a time.
 *
 * Deliberately never names the upstream aggregator. It is "consensus" here, on
 * screen and in build/consensus-update.py's output; see that file's naming note.
 *
 * Sits under Tools next to Waivers because it answers the neighbouring question:
 * Waivers is "who should I add", this is "who should I start". It reuses the
 * same Segmented control and row primitives rather than growing a third table
 * dialect. */

import { useEffect, useMemo, useState } from "react";
import {
  fetchJSON, relTime,
  type Consensus, type ConsensusOwner, type ConsensusRow,
} from "@/lib/data";
import {
  Headshot, PlayerLink, PageHeader, TeamAvatar, MINE_ROW, YouBadge, Note,
} from "@/components/gggg/primitives";
import { Segmented } from "@/components/gggg/segmented";
import { cn } from "@/lib/utils";

const POSITIONS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"] as const;
type Pos = (typeof POSITIONS)[number];

type Filter = "all" | "free" | "mine";
/* Labelled options, so Segmented is called with an explicit <Filter> below: its
   options prop is a union of "plain values" and "[value, label] pairs", and
   inference resolves that union against the plain branch (T = string). */
const FILTERS: readonly (readonly [Filter, string])[] = [
  ["all", "All"],
  ["free", "Free agents"],
  ["mine", "My team"],
];

/* Which tab you were last on, so opening the page on a phone during a Sunday
   morning lineup check lands where you left it. Same shape as the sidebar's
   section memory. */
const TAB_KEY = "gggg.consensus.pos.v1";

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

/* Matchup grade. The letter is the signal; the colour just makes a column of
   them scannable, so it tracks the letter and ignores the +/−. */
function Grade({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-muted-foreground">—</span>;
  const tone =
    grade.startsWith("A") ? "bg-ok/15 text-ok"
    : grade.startsWith("B") ? "bg-info/15 text-info"
    : grade.startsWith("C") ? "bg-secondary text-muted-foreground"
    : "bg-bad/15 text-bad";
  return (
    <span className={cn("inline-block rounded-sm px-1.5 py-px font-mono text-[11px] font-bold", tone)}>
      {grade}
    </span>
  );
}

/* Week-over-week rank movement. Negative delta = ranked higher than last week,
   so the arrow, not the sign, is what the reader goes by. */
function Delta({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return null;
  const up = delta < 0;
  return (
    <span className={cn("ml-1 font-mono text-[10px]", up ? "text-ok" : "text-bad")}>
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}

function OwnerTag({ owner, mine }: { owner?: ConsensusOwner; mine: boolean }) {
  if (!owner) {
    return <span className="text-xs font-bold text-ok">Free agent</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <TeamAvatar src={owner.avatar} name={owner.team} className="size-4 border-0" />
      <span className="truncate text-xs text-muted-foreground">{owner.team}</span>
      {mine && <YouBadge />}
    </span>
  );
}

export default function ConsensusPage() {
  const [c, setC] = useState<Consensus | null>(null);
  const [error, setError] = useState(false);
  const [pos, setPos] = useState<Pos>("QB");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as Pos | null;
      if (saved && (POSITIONS as readonly string[]).includes(saved)) setPos(saved);
    } catch {}
    fetchJSON<Consensus>("consensus.json").then(setC).catch(() => setError(true));
  }, []);

  const pick = (p: Pos) => {
    setPos(p);
    try {
      localStorage.setItem(TAB_KEY, p);
    } catch {}
  };

  const mineId = c?.my_owner_id ?? null;
  const rows: ConsensusRow[] = useMemo(() => {
    const all = c?.rankings?.[pos] ?? [];
    if (filter === "free") return all.filter((r) => !r.own);
    if (filter === "mine") return all.filter((r) => r.own && r.own === mineId);
    return all;
  }, [c, pos, filter, mineId]);

  const subtitle = c?.ready
    ? `Week ${c.week} · ${c.season} · PPR${c.experts ? ` · ${c.experts} experts` : ""}`
    : c
      ? "No weekly rankings published yet"
      : "Loading…";

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow="Tools"
          title="Consensus Rankings"
          subtitle="Could not load the consensus rankings."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow="Tools"
        title="Consensus Rankings"
        subtitle={subtitle}
        updated={c ? `Updated ${relTime(c.generated)}` : ""}
      />

      {!c && <div className="h-64 animate-pulse rounded-lg border bg-card" />}

      {c && !c.ready && (
        <Note>
          Weekly rankings publish once the regular season starts. Until then the{" "}
          <strong>Waiver Wire</strong> and <strong>Draft</strong> pages carry the
          season-long consensus.
        </Note>
      )}

      {c && c.ready && (
        <>
          <Segmented label="Position" options={POSITIONS} value={pos} onChange={pick} />
          <Segmented<Filter> label="Ownership" options={FILTERS} value={filter} onChange={setFilter} />

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[340px] text-sm">
              <thead>
                <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-8 px-2 py-1.5 text-left sm:w-10 sm:px-3 sm:py-2">#</th>
                  <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Player</th>
                  <th className="px-2 py-1.5 text-center sm:px-3 sm:py-2">Grade</th>
                  <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Proj</th>
                  <th className="hidden px-2 py-1.5 text-right sm:px-3 sm:py-2 md:table-cell">
                    Best–Worst
                  </th>
                  <th className="hidden px-2 py-1.5 text-right sm:px-3 sm:py-2 md:table-cell">
                    Std
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const owner = r.own ? c.owners[r.own] : undefined;
                  const mine = Boolean(r.own && r.own === mineId);
                  const bye = r.opp === "BYE" || !r.opp;
                  return (
                    <tr
                      key={`${r.pid ?? r.name}-${i}`}
                      className={cn("border-b last:border-0", mine && MINE_ROW)}
                    >
                      <td className="px-2 py-1.5 font-mono tabular-nums text-muted-foreground sm:px-3 sm:py-2">
                        {r.rank ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="flex items-center gap-2">
                          <Headshot pid={r.pid ?? ""} pos={r.pos} nflTeam={r.team} />
                          <div className="min-w-0">
                            <div className="truncate font-bold">
                              <PlayerLink pid={r.pid}>{r.name}</PlayerLink>
                              <InjuryBadge injury={r.injury} />
                              <Delta delta={r.delta} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                              <span>
                                {r.pos_rank ?? r.pos} · {r.team}
                              </span>
                              <span className={cn(bye && "text-warn")}>
                                {bye ? `BYE${r.bye ? ` (wk ${r.bye})` : ""}` : r.opp}
                              </span>
                            </div>
                            <div className="mt-0.5">
                              <OwnerTag owner={owner} mine={mine} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center sm:px-3 sm:py-2">
                        <Grade grade={r.grade} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums sm:px-3 sm:py-2">
                        {r.proj != null ? r.proj.toFixed(1) : "—"}
                      </td>
                      <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground sm:px-3 sm:py-2 md:table-cell">
                        {r.best != null && r.worst != null ? `${r.best}–${r.worst}` : "—"}
                      </td>
                      <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground sm:px-3 sm:py-2 md:table-cell">
                        {r.std != null ? r.std.toFixed(1) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {filter === "mine"
                        ? "None of your players are ranked at this position."
                        : "Nothing ranked here."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Consensus of {c.experts ?? "many"} expert rankings for full PPR, refreshed
            through the week{c.last_update ? ` (source updated ${c.last_update})` : ""}.{" "}
            <strong>Best–Worst</strong> is the range those experts put a player in and{" "}
            <strong>Std</strong> how much they disagree — a wide spread is a volatile
            start. <strong>Proj</strong> is projected PPR points.
          </p>
        </>
      )}
    </div>
  );
}
