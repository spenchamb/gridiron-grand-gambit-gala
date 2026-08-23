"use client";

/* Sections of the League hub that more than one of its three modes renders.
 * Kept out of app/page.tsx so that file stays a readable mode-selector. */

import { useState } from "react";
import Link from "next/link";
import {
  type BracketMatch, type HistoryFile, type LeagueFile, type LeagueStanding,
  type TeamTransaction,
} from "@/lib/data";
import { StatCard, TeamAvatar } from "@/components/gggg/primitives";
import { AllTimeBars, ChampionsLedger } from "@/components/gggg/viz";
import { cn } from "@/lib/utils";

export const SLOT_NAME: Record<string, string> = {
  WRRB_FLEX: "W/R", REC_FLEX: "W/T", SUPER_FLEX: "SFLX",
};

export const SectionLabel = ({
  children, sub,
}: { children: React.ReactNode; sub?: React.ReactNode }) => (
  <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
    {children}
    {sub && <span className="font-sans normal-case tracking-normal"> — {sub}</span>}
  </p>
);

export const fmtDate = (ms: number | string) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ChampionBanner({
  season, champion, runnerUp, regularSeason,
}: { season: string; champion: string; runnerUp?: string | null; regularSeason?: string | null }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-l-4 border-l-warn bg-card px-5 py-4">
      <div className="text-4xl leading-none">🏆</div>
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          {season} Champion
        </div>
        <div className="my-0.5 text-2xl font-extrabold">{champion}</div>
        <div className="text-[13px] text-muted-foreground">
          def. {runnerUp ?? "—"} · Regular-season #1: {regularSeason ?? "—"}
        </div>
      </div>
    </div>
  );
}

export function LeagueSetup({ meta }: { meta: LeagueFile["meta"] }) {
  const sd = meta.scoring_detail ?? {};
  const cards: [string, string][] = [
    ["Scoring", meta.scoring],
    ["Teams", `${meta.total_rosters}${meta.divisions ? ` · ${meta.divisions} divisions` : ""}`],
    ["Playoffs", `${meta.playoff_teams || "?"} teams · from Wk ${meta.playoff_week_start || "?"}`],
    ["Bench", `${meta.bench_slots} spots`],
    ["Reception", `${sd.rec ?? "—"} pt`],
    ["Pass TD", `${sd.pass_td ?? "—"} pt`],
  ];
  return (
    <section className="mb-10">
      <SectionLabel sub="the weekly confines">League Setup</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([l, v]) => (
          <StatCard key={l} label={l} value={v} />
        ))}
      </div>
      <div className="mt-3">
        <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Weekly starting lineup
        </span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(meta.roster_positions ?? []).map((p, i) => (
            <span
              key={i}
              className="rounded-md border bg-secondary px-2 py-0.5 font-mono text-[11px] font-bold"
            >
              {SLOT_NAME[p] ?? p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Standings({ rows, isFinal }: { rows: LeagueStanding[]; isFinal: boolean }) {
  return (
    <section className="mb-10">
      <SectionLabel>{isFinal ? "Final Standings" : "Standings"}</SectionLabel>
      {/* Standings is the first table a visitor meets, and eight columns do not
          fit a phone. Rank / team / record / points earn their place at every
          size; streak and PA arrive at sm, the two derived columns at md. */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-8 px-2 py-1.5 text-left sm:w-10 sm:px-3 sm:py-2">#</th>
              <th className="px-2 py-1.5 text-left sm:px-3 sm:py-2">Team</th>
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">W-L</th>
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">PF</th>
              <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">PA</th>
              <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">All-Play</th>
              <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">Luck</th>
              <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">Strk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.roster_id} className="border-b last:border-0">
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{s.rank}</td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                  <Link
                    href={{ pathname: "/team", query: { owner: s.owner_id } }}
                    className="flex items-center gap-2 hover:text-primary"
                  >
                    <TeamAvatar src={s.avatar} name={s.team} />
                    <span className="truncate font-bold">{s.team}</span>
                  </Link>
                  <div className="pl-9 text-xs text-muted-foreground">{s.owner}</div>
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                  {s.wins}-{s.losses}
                  {s.ties ? `-${s.ties}` : ""}
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">{s.pf.toFixed(1)}</td>
                <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground sm:table-cell sm:px-3 sm:py-2">
                  {s.pa.toFixed(1)}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                  {s.all_play}
                </td>
                <td
                  className={cn(
                    "hidden px-2 py-1.5 text-right font-mono tabular-nums md:table-cell sm:px-3 sm:py-2",
                    s.luck > 0 ? "text-ok" : s.luck < 0 ? "text-bad" : "text-muted-foreground",
                  )}
                >
                  {s.luck > 0 ? "+" : ""}
                  {s.luck.toFixed(1)}
                </td>
                <td
                  className={cn(
                    "hidden px-2 py-1.5 text-right font-bold sm:table-cell sm:px-3 sm:py-2",
                    s.streak.startsWith("W") && "text-ok",
                    s.streak.startsWith("L") && "text-bad",
                  )}
                >
                  {s.streak}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The key only describes columns you can currently see. */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span className="hidden sm:inline">PF / PA — points for / against</span>
        <span className="sm:hidden">PF — points for</span>
        <span className="hidden md:inline">All-Play — record vs the entire league each week</span>
        <span className="hidden md:inline">Luck — actual wins minus all-play expectation</span>
      </div>
    </section>
  );
}

export function PowerRankings({ rows }: { rows: LeagueFile["power_rankings"] }) {
  if (!rows?.length) return null;
  return (
    <section className="mb-10">
      <SectionLabel sub="by all-play win %">Power Rankings</SectionLabel>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[440px] text-sm">
          <tbody>
            {rows.map((p) => (
              <tr key={p.rank} className="border-b last:border-0">
                <td className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 font-mono text-muted-foreground">{p.rank}</td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                  <div className="flex items-center gap-2">
                    <TeamAvatar src={p.avatar} name={p.team} />
                    <span className="truncate font-bold">{p.team}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                  {(p.all_play_pct * 100).toFixed(1)}%
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {p.all_play} all-play
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {p.record} · {p.pf.toFixed(0)} PF
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                  seed {p.seed_rank}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Records({ r }: { r: LeagueFile["records"] }) {
  const g = (k: string) => r?.[k] as Record<string, number | string> | undefined;
  if (!g("highest_score")) return null;
  const num = (o: Record<string, number | string> | undefined, k: string, d = 1) =>
    o && typeof o[k] === "number" ? (o[k] as number).toFixed(d) : "—";

  const cards: ([string, string, string] | null)[] = [
    ["Highest Score", num(g("highest_score"), "pts"), `${g("highest_score")!.team} · Wk ${g("highest_score")!.week} ${g("highest_score")!.season}`],
    ["Lowest Score", num(g("lowest_score"), "pts"), `${g("lowest_score")!.team} · Wk ${g("lowest_score")!.week} ${g("lowest_score")!.season}`],
    ["Biggest Blowout", `+${num(g("biggest_blowout"), "margin")}`, `${g("biggest_blowout")!.team} over ${g("biggest_blowout")!.opp} (${g("biggest_blowout")!.season})`],
    g("closest_game")
      ? ["Closest Game", num(g("closest_game"), "margin", 2), `${g("closest_game")!.team} edged ${g("closest_game")!.opp} (${g("closest_game")!.season})`]
      : null,
    ["Highest Matchup", num(g("highest_matchup"), "total"), `${g("highest_matchup")!.team} vs ${g("highest_matchup")!.opp} (${g("highest_matchup")!.season})`],
    ["Longest Win Streak", `${g("longest_streak")!.len} W`, `${g("longest_streak")!.team} (${g("longest_streak")!.season})`],
    ["Luckiest", `+${num(g("luckiest"), "luck")}`, `${g("luckiest")!.team} (${g("luckiest")!.season})`],
    ["Unluckiest", num(g("unluckiest"), "luck"), `${g("unluckiest")!.team} (${g("unluckiest")!.season})`],
    ["Most Points (Season)", num(g("most_pf"), "pf", 0), `${g("most_pf")!.team} (${g("most_pf")!.season})`],
  ];

  return (
    <section className="mb-10">
      <SectionLabel sub="all-time">Records &amp; Superlatives</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.filter(Boolean).map((c) => (
          <StatCard key={c![0]} label={c![0]} value={c![1]} sub={c![2]} accent />
        ))}
      </div>
    </section>
  );
}

export function HeadToHead({ h2h }: { h2h: HistoryFile["h2h"] }) {
  const owners = (h2h?.owners ?? []) as { id: string; name: string }[];
  const matrix = (h2h?.matrix ?? {}) as Record<string, Record<string, { w: number; l: number; t: number }>>;
  if (!owners.length) return null;
  const short = (n: string) => (n.length > 10 ? `${n.slice(0, 9)}…` : n);

  return (
    <section className="mb-10">
      <SectionLabel sub="all-time record">Head-to-Head</SectionLabel>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-2 py-1.5" />
              {owners.map((o) => (
                <th
                  key={o.id}
                  className="px-2 py-1.5 font-mono text-[10px] uppercase text-muted-foreground"
                >
                  {short(o.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {owners.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1.5 text-left font-mono text-[10px] uppercase text-muted-foreground">
                  {short(row.name)}
                </th>
                {owners.map((col) => {
                  if (row.id === col.id)
                    return (
                      <td key={col.id} className="px-2 py-1.5 text-center text-muted-foreground">
                        —
                      </td>
                    );
                  const rec = matrix[row.id]?.[col.id] ?? { w: 0, l: 0, t: 0 };
                  const played = rec.w || rec.l || rec.t;
                  return (
                    <td
                      key={col.id}
                      className={cn(
                        "px-2 py-1.5 text-center font-mono tabular-nums",
                        rec.w > rec.l && "bg-ok/15 text-ok",
                        rec.l > rec.w && "bg-bad/15 text-bad",
                      )}
                    >
                      {played ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ""}` : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>Read across: row team vs each column.</span>
      </div>
    </section>
  );
}

export function LeagueHistory({ h }: { h: HistoryFile }) {
  return (
    <section className="mb-10">
      <SectionLabel>League History</SectionLabel>
      <div className="mb-4">
        <ChampionsLedger seasons={h.seasons} />
      </div>
      <SectionLabel>All-Time Win %</SectionLabel>
      <div className="mb-4 rounded-lg border bg-card px-4 py-2">
        <AllTimeBars rows={h.all_time} />
      </div>
      <SectionLabel>All-Time Standings</SectionLabel>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[400px] text-sm">
          <thead>
            <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Manager</th>
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">All-Time</th>
              <th className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3 sm:py-2">Win%</th>
              <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2">PF</th>
              <th className="px-2 py-1.5 text-right sm:px-3 sm:py-2">Titles</th>
              <th className="hidden px-2 py-1.5 text-right md:table-cell sm:px-3 sm:py-2" />
            </tr>
          </thead>
          <tbody>
            {h.all_time.map((a, i) => (
              <tr key={a.owner} className="border-b last:border-0">
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                  <div className="flex items-center gap-2">
                    <TeamAvatar src={a.avatar} name={a.owner} />
                    <span className="truncate font-bold">{a.owner}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                  {a.wins}-{a.losses}
                  {a.ties ? `-${a.ties}` : ""}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums sm:table-cell sm:px-3 sm:py-2">
                  {(a.win_pct * 100).toFixed(1)}%
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                  {a.pf.toFixed(0)}
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                  {a.championships ? (
                    "🏆".repeat(a.championships)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground md:table-cell sm:px-3 sm:py-2">
                  {a.seasons} szn · best {a.best_finish}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Bracket({ winners }: { winners: BracketMatch[] }) {
  if (!winners?.length)
    return (
      <section className="mb-10">
        <SectionLabel>Playoff Bracket</SectionLabel>
        <p className="text-sm text-muted-foreground">No bracket.</p>
      </section>
    );
  const rounds: Record<number, BracketMatch[]> = {};
  winners.forEach((m) => (rounds[m.round] = [...(rounds[m.round] ?? []), m]));
  const maxR = Math.max(...Object.keys(rounds).map(Number));
  const NAMES: Record<number, string> = { 1: "Round 1", 2: "Semifinals", 3: "Finals" };

  return (
    <section className="mb-10">
      <SectionLabel>Playoff Bracket</SectionLabel>
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.keys(rounds)
          .map(Number)
          .sort((a, b) => a - b)
          .map((r) => (
            <div key={r}>
              <h4 className="mb-2 font-mono text-[11px] uppercase tracking-[0.13em] text-primary">
                {r === maxR ? "Championship" : (NAMES[r] ?? `Round ${r}`)}
              </h4>
              {rounds[r].map((m, i) => {
                const place =
                  (m as BracketMatch & { place?: number }).place === 1
                    ? "Championship"
                    : (m as BracketMatch & { place?: number }).place === 3
                      ? "3rd Place"
                      : (m as BracketMatch & { place?: number }).place === 5
                        ? "5th Place"
                        : "";
                return (
                  <div key={i} className="mb-2 rounded-md border">
                    {place && (
                      <div className="border-b px-2 py-1 font-mono text-[9px] uppercase text-muted-foreground">
                        {place}
                      </div>
                    )}
                    {[m.t1, m.t2].map((t, j) => (
                      <div
                        key={j}
                        className={cn(
                          "px-2 py-1.5 text-sm",
                          j === 0 && "border-b",
                          m.winner === t ? "font-bold text-ok" : "text-muted-foreground",
                        )}
                      >
                        {t ?? "TBD"}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </section>
  );
}

export function Transactions({ tx, page = 25 }: { tx: TeamTransaction[]; page?: number }) {
  const [shown, setShown] = useState(page);
  if (!tx?.length)
    return (
      <section className="mb-10">
        <SectionLabel>Transactions</SectionLabel>
        <p className="text-sm text-muted-foreground">No transactions yet this season.</p>
      </section>
    );
  return (
    <section className="mb-10">
      <SectionLabel>Transactions</SectionLabel>
      <div className="rounded-lg border bg-card">
        {tx.slice(0, shown).map((t, i) => (
          <div key={i} className="flex items-start gap-2 border-b px-3 py-2 last:border-0">
            <span className="mt-0.5 rounded-sm bg-secondary px-1.5 py-px font-mono text-[9px] font-bold uppercase text-muted-foreground">
              {t.type === "free_agent" ? "FA" : t.type}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              {t.type === "trade" ? (
                <div>
                  <strong>Trade</strong> — {t.summary}
                </div>
              ) : (
                <div>
                  {t.team} <span className="text-ok">+ {t.add}</span>{" "}
                  <span className="text-muted-foreground">
                    ({t.add_pos}
                    {t.add_team ? ` · ${t.add_team}` : ""})
                  </span>
                  {t.drop && <span className="text-bad"> − {t.drop}</span>}
                </div>
              )}
              <div className="text-xs text-muted-foreground">{fmtDate(t.created)}</div>
            </div>
          </div>
        ))}
      </div>
      {shown < tx.length && (
        <button
          type="button"
          onClick={() => setShown(shown + page)}
          className="mt-3 w-full rounded-md border py-2 text-sm hover:bg-accent"
        >
          Show more
        </button>
      )}
    </section>
  );
}

export function LastSeason({ h, league }: { h: HistoryFile; league: LeagueFile }) {
  const champ = (h.seasons ?? []).find((s) => s.champion);
  if (!champ) return null;
  const sameSeason = String(league.meta.season) === String(champ.season);
  return (
    <section className="mb-10">
      <SectionLabel sub={`${champ.season} final recap`}>Last Season</SectionLabel>
      <details className="rounded-lg border bg-card">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm">
          <span>Champion &amp; final standings</span>
          <span className="font-bold text-warn">🏆 {champ.champion}</span>
        </summary>
        <div className="border-t px-4 py-4">
          <div className="mb-4">
            <ChampionBanner
              season={champ.season}
              champion={champ.champion!}
              runnerUp={champ.runner_up}
              regularSeason={champ.regular_season}
            />
          </div>
          {sameSeason ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[400px] text-sm">
                <thead>
                  <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Team</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">W-L</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">PF</th>
                    <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">PA</th>
                  </tr>
                </thead>
                <tbody>
                  {league.standings.map((s) => (
                    <tr key={s.roster_id} className="border-b last:border-0">
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{s.rank}</td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="flex items-center gap-2">
                          <TeamAvatar src={s.avatar} name={s.team} />
                          <span className="truncate font-bold">{s.team}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                        {s.wins}-{s.losses}
                        {s.ties ? `-${s.ties}` : ""}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                        {s.pf.toFixed(1)}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                        {s.pa.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* league.json standings are the CURRENT season, so they only belong
               here when the current season is the one that just finished. */
            <p className="text-sm text-muted-foreground">
              Full {champ.season} standings live on the{" "}
              <Link href="/recap" className="text-primary hover:underline">
                recap page
              </Link>
              .
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
