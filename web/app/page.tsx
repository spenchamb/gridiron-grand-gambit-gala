"use client";

/* The League hub.
 *
 * Three modes, picked in this order:
 *   preseason.json.active                      -> preseason
 *   now.json.active OR league.meta.status===in_season -> in-season
 *   otherwise                                  -> complete
 *
 * The `|| status === in_season` fallback matters: the completed-season view
 * (champion banner, final standings, bracket) is nonsense mid-season, and
 * now.json does not exist until the first builder cycle after a deploy. An
 * in-season league therefore stays on the in-season layout with the week
 * sections simply hidden until now.json lands. */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchJSON, relTime,
  type HistoryFile, type LeagueFile,
  type Meta, type NowFile, type NowSide, type PreseasonFile, type Watch, type WhatIf, type WiSeason,
} from "@/lib/data";
import { PageHeader, PlayerLink, StatCard, TeamAvatar } from "@/components/gggg/primitives";
import {
  Bracket, ChampionBanner, HeadToHead, LastSeason, LeagueHistory, LeagueSetup,
  PowerRankings, Records, SectionLabel, SLOT_NAME, Standings, Transactions, fmtDate,
} from "@/components/gggg/league-sections";
import { TwitterFeed } from "@/components/gggg/twitter-feed";
import { Segmented } from "@/components/gggg/segmented";
import { LiveBadge, useAutoRefresh, LIVE_MS, PRE_MS, type AutoRefresh } from "@/components/gggg/live";
import { isMine, useMe } from "@/lib/me";
import { cn } from "@/lib/utils";

type Mode = "preseason" | "inseason" | "complete";

const STATUS_LABEL: Record<string, string> = {
  pre_draft: "Draft not started", drafting: "Draft in progress",
  complete: "Complete", in_season: "In season",
};
const labelStatus = (s?: string) => (s && STATUS_LABEL[s]) || s || "TBD";


/* ── Draft countdown to 1:00 PM ET on the listed day ────────────────────── */
function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const utc = Date.UTC(y, m - 1, d, h, min, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    +p.year, +p.month - 1, +p.day, +(p.hour === "24" ? 0 : p.hour), +p.minute, +p.second,
  );
  return utc - (asUtc - utc);
}

function DraftCountdown({ startMs }: { startMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const TZ = "America/New_York";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    })
      .formatToParts(new Date(startMs))
      .map((x) => [x.type, x.value]),
  );
  const target = zonedTimeToUtc(+p.year, +p.month, +p.day, 13, 0, TZ);
  let diff = target - now;

  if (diff <= 0)
    return <div className="mt-3 font-mono text-sm font-bold text-primary">Draft is live 🏈</div>;

  const days = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hrs = Math.floor(diff / 3600000); diff -= hrs * 3600000;
  const mins = Math.floor(diff / 60000); diff -= mins * 60000;
  const secs = Math.floor(diff / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="mt-3 flex items-end gap-3" aria-live="polite">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Draft in
      </span>
      {([[days, "days"], [pad(hrs), "hrs"], [pad(mins), "min"], [pad(secs), "sec"]] as const).map(
        ([v, l]) => (
          <div key={l} className="text-center">
            <span className="block font-mono text-xl font-bold tabular-nums">{v}</span>
            <span className="block font-mono text-[9px] uppercase text-muted-foreground">{l}</span>
          </div>
        ),
      )}
    </div>
  );
}

/* ── In-season: this week's scores, compact ─────────────────────────────── */
/* The hub is a standings-and-stats page; nobody watches lineups from here
   during the window. Each matchup is one two-line row, and the full lineup
   view lives on the Matchups page the row links to. */
function Scoreboard({ n, live }: { n: NowFile; live: AutoRefresh }) {
  const pre = n.phase === "pre";
  const me = useMe();
  const games = n.games ?? [];
  if (!games.length) return null;

  const Row = ({ s, lead, dim }: { s: NowSide; lead: boolean; dim: boolean }) => (
    <div className={cn("flex items-center gap-2", dim && "text-muted-foreground")}>
      <span className={cn("min-w-0 truncate", lead && "font-bold", isMine(me, s.owner_id) && "text-primary")}>
        {s.team}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{s.record}</span>
      <span className={cn("ml-auto shrink-0 tabular-nums", lead && "font-bold")}>
        {(pre ? s.proj : s.points).toFixed(1)}
      </span>
    </div>
  );

  return (
    <section className="mb-10">
      <div className="flex items-start justify-between gap-3">
        <SectionLabel sub={pre ? "projected · lineups lock at kickoff" : "tap a game for lineups"}>
          {`Week ${n.week}`}
        </SectionLabel>
        <LiveBadge live={live} refresh={n.phase !== "final"} className="shrink-0" />
      </div>
      <ul className="grid overflow-hidden rounded-lg border bg-card text-sm sm:grid-cols-2">
        {games.map((g) => {
          const av = pre ? g.a.proj : g.a.points;
          const bv = pre ? g.b.proj : g.b.points;
          /* Older now.json files have no per-side counts; say nothing then rather
             than calling an unfinished game final. */
          const left = g.a.to_play == null
            ? null
            : (g.a.to_play ?? 0) + (g.a.in_play ?? 0) + (g.b.to_play ?? 0) + (g.b.in_play ?? 0);
          return (
            <li key={g.matchup_id} className="border-b sm:odd:border-r">
              <Link
                href="/matchups"
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-accent/40"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Row s={g.a} lead={av > bv} dim={bv > av} />
                  <Row s={g.b} lead={bv > av} dim={av > bv} />
                </div>
                <span className="w-12 shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
                  {pre || left == null ? "" : left ? `${left} to go` : "Final"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── In-season: the numbers behind the standings ────────────────────────── */
type Board = "allplay" | "median" | "pf" | "luck";

const BOARDS: readonly (readonly [Board, string])[] = [
  ["allplay", "All-Play"],
  ["median", "Median"],
  ["pf", "Points For"],
  ["luck", "Luck"],
];

const BOARD_NOTE: Record<Board, string> = {
  allplay: "Every team's score against all eleven others, every week.",
  median: "Real record plus a game against the league median each week.",
  pf: "Raw scoring, regardless of who you drew.",
  luck: "Wins above what a typical schedule would have given you.",
};

type BoardRow = { team: string; value: string; sub: string; tone?: "ok" | "bad" };

function boardRows(b: Board, league: LeagueFile, wi: WiSeason | null): BoardRow[] {
  const st = league.standings;
  const byTeam = new Map(st.map((s) => [s.team, s]));
  if (b === "pf") {
    return [...st]
      .sort((x, y) => y.pf - x.pf)
      .map((s) => ({ team: s.team, value: s.pf.toFixed(1), sub: `PA ${s.pa.toFixed(1)}` }));
  }
  if (b === "allplay") {
    const rows = wi?.all_play ?? [...st].sort((x, y) => y.all_play_pct - x.all_play_pct).map((s, i) => ({
      team: s.team, rank: i + 1, record: s.all_play,
    }));
    return [...rows].sort((x, y) => x.rank - y.rank).map((r) => ({
      team: r.team,
      value: `${Math.round((byTeam.get(r.team)?.all_play_pct ?? 0) * 100)}%`,
      sub: r.record,
    }));
  }
  if (b === "median") {
    return [...(wi?.median ?? [])].sort((x, y) => x.rank - y.rank).map((r) => ({
      team: r.team, value: r.record, sub: `W-L ${byTeam.get(r.team) ? `${byTeam.get(r.team)!.wins}-${byTeam.get(r.team)!.losses}` : "—"}`,
    }));
  }
  return [...(wi?.schedule_luck ?? [])].sort((x, y) => y.luck - x.luck).map((r) => ({
    team: r.team,
    value: `${r.luck > 0 ? "+" : ""}${r.luck.toFixed(1)}`,
    sub: `${r.actual} · typical ${r.median_w.toFixed(0)} W`,
    tone: r.luck >= 1 ? "ok" : r.luck <= -1 ? "bad" : undefined,
  }));
}

function StatBoards({ league, wi, midWeek }: { league: LeagueFile; wi: WiSeason | null; midWeek: boolean }) {
  const [board, setBoard] = useState<Board>("allplay");
  const me = useMe();
  const st = league.standings;
  const seat = new Map(st.map((s) => [s.team, s.rank]));
  const avatar = new Map(st.map((s) => [s.team, s.avatar]));
  const owner = new Map(st.map((s) => [s.team, s.owner_id]));
  const rows = boardRows(board, league, wi);
  /* Median and luck come from the what-if build; an older file without them
     just hides those two tabs rather than showing an empty table. */
  const options = BOARDS.filter(([b]) => (b !== "median" || wi?.median?.length) && (b !== "luck" || wi?.schedule_luck?.length));

  return (
    <section className="mb-10">
      <SectionLabel sub="who's actually good, and who's just lucky">The Numbers</SectionLabel>
      <Segmented<Board> options={options} value={board} onChange={setBoard} label="Stat" />
      <p className="mb-2 text-xs text-muted-foreground">
        {BOARD_NOTE[board]}
        {midWeek && board !== "pf" && " Counts this week's scores so far."}
      </p>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-3 border-b px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span className="w-5 text-right">#</span>
          <span className="flex-1">Team</span>
          <span className="w-10 text-right">Std</span>
          <span className="w-16 text-right">{BOARDS.find(([b]) => b === board)?.[1]}</span>
        </div>
        <ol>
          {rows.map((r, i) => {
            const std = seat.get(r.team);
            const gap = std ? std - (i + 1) : 0;
            return (
              <li
                key={r.team}
                className={cn("flex items-center gap-3 border-b px-4 py-2 last:border-b-0", isMine(me, owner.get(r.team)) && "bg-primary/5")}
              >
                <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="hidden sm:contents"><TeamAvatar src={avatar.get(r.team) ?? null} name={r.team} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{r.team}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{r.sub}</div>
                </div>
                {/* Where they sit in the real standings. A big gap is the story:
                    green means the standings undersell them, red oversell. */}
                <span
                  className={cn(
                    "w-10 text-right text-xs tabular-nums",
                    board === "luck" || Math.abs(gap) < 3 ? "text-muted-foreground" : gap > 0 ? "text-ok" : "text-bad",
                  )}
                >
                  {std ?? "—"}
                </span>
                <span
                  className={cn(
                    "w-16 text-right font-bold tabular-nums",
                    r.tone === "ok" && "text-ok",
                    r.tone === "bad" && "text-bad",
                  )}
                >
                  {r.value}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* Each fact is computed from the same files the boards read, and simply drops
   out when its inputs are missing or the story is not there (a gap of one
   place is not a headline). */
function insights(league: LeagueFile, wi: WiSeason | null): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = [];
  const st = league.standings;
  if (!st.length) return out;
  const rec = (s: (typeof st)[number]) => `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`;
  const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th"}`;

  const byPf = [...st].sort((a, b) => b.pf - a.pf);
  const robbed = byPf
    .map((s, i) => ({ s, gap: s.rank - (i + 1) }))
    .sort((a, b) => b.gap - a.gap)[0];
  if (robbed && robbed.gap >= 3) {
    out.push({
      head: "Robbed",
      body: `${robbed.s.team} is ${ord(byPf.indexOf(robbed.s) + 1)} in points (${robbed.s.pf.toFixed(1)}) and ${ord(robbed.s.rank)} in the standings at ${rec(robbed.s)}.`,
    });
  }
  const fraud = byPf
    .map((s, i) => ({ s, gap: i + 1 - s.rank }))
    .sort((a, b) => b.gap - a.gap)[0];
  if (fraud && fraud.gap >= 3) {
    out.push({
      head: "Living right",
      body: `${fraud.s.team} sits ${ord(fraud.s.rank)} at ${rec(fraud.s)} on the ${ord(byPf.indexOf(fraud.s) + 1)}-most points in the league.`,
    });
  }

  const luck = [...(wi?.schedule_luck ?? [])].sort((a, b) => a.luck - b.luck);
  const worst = luck[0];
  if (worst && worst.luck <= -1) {
    out.push({
      head: "Worst schedule",
      body: `${worst.team} is ${worst.actual}; across every possible schedule they'd typically have ${worst.median_w.toFixed(0)} wins, and as many as ${worst.best.split("-")[0]}.`,
    });
  }
  const best = luck[luck.length - 1];
  if (best && best.luck >= 1) {
    out.push({
      head: "Kindest schedule",
      body: `${best.team} is ${best.actual}. A typical schedule gets them ${best.median_w.toFixed(0)} wins; the worst one, ${best.worst.split("-")[0]}.`,
    });
  }

  const ap = [...st].sort((a, b) => b.all_play_pct - a.all_play_pct)[0];
  if (ap) {
    out.push({
      head: "Best week in, week out",
      body: `${ap.team} would beat ${Math.round(ap.all_play_pct * 100)}% of the league on any given week (${ap.all_play} all-play).`,
    });
  }

  const eff = league.manager_efficiency as { team: string; pct: number; left: number }[] | undefined;
  const bench = eff?.length ? [...eff].sort((a, b) => b.left - a.left)[0] : null;
  if (bench && bench.left > 0) {
    out.push({
      head: "Bench warmer",
      body: `${bench.team} has left ${bench.left.toFixed(1)} points on the bench this season, the most in the league (${bench.pct.toFixed(1)}% lineup efficiency).`,
    });
  }

  const hi = league.records?.highest_score as { team?: string; pts?: number; week?: number; season?: string } | undefined;
  if (hi?.season === league.meta.season && hi.team && hi.pts != null) {
    out.push({
      head: "Season high",
      body: `${hi.team} put up ${hi.pts.toFixed(2)} in week ${hi.week}, the league's all-time single-week record.`,
    });
  }
  return out;
}

function FunFacts({ league, wi }: { league: LeagueFile; wi: WiSeason | null }) {
  const facts = insights(league, wi);
  if (!facts.length) return null;
  return (
    <section className="mb-10">
      <SectionLabel sub="what the numbers are saying">Storylines</SectionLabel>
      <ul className="grid gap-3 sm:grid-cols-2">
        {facts.map((f) => (
          <li key={f.head} className="rounded-lg border bg-card px-4 py-3">
            <h3 className="font-brand text-base tracking-tight">{f.head}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}


function WatchCards({ pw, uw }: { pw: Watch | null; uw: Watch | null }) {
  if (!pw && !uw) return null;
  /* Both sims carry a `ready` flag. Before any games are played every team sits
     at 100%, so the odds are meaningless — show a placeholder until it flips. */
  const top = (w: Watch | null, rankKey: "playoff_rank" | "punish_rank", probKey: "playoff_prob" | "punish_prob") =>
    w?.ready && w.teams
      ? [...w.teams]
          .sort((a, b) => (a[rankKey] ?? 0) - (b[rankKey] ?? 0))
          .slice(0, 4)
          .map((t) => [t.team, `${Math.round((t[probKey] ?? 0) * 100)}%`] as [string, string])
      : [];

  const Card = ({
    href, head, rows, empty,
  }: { href: string; head: string; rows: [string, string][]; empty: string }) => (
    <Link
      href={href}
      className="rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40"
    >
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.13em] text-primary">
        {head}
      </div>
      {rows.length ? (
        rows.map(([a, b]) => (
          <div key={a} className="flex justify-between gap-3 py-0.5 text-sm">
            <span className="truncate">{a}</span>
            <span className="font-mono tabular-nums">{b}</span>
          </div>
        ))
      ) : (
        <div className="text-xs text-muted-foreground">{empty}</div>
      )}
    </Link>
  );

  return (
    <section className="mb-10">
      <SectionLabel sub="playoff odds & the punishment race">Watch</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        {pw?.teams && (
          <Card
            href="/playoff"
            head="Playoff Watch"
            rows={top(pw, "playoff_rank", "playoff_prob")}
            empty="Odds open once the first games are in the books."
          />
        )}
        {uw?.teams && (
          <Card
            href="/punish"
            head="Punish Watch"
            rows={top(uw, "punish_rank", "punish_prob")}
            empty="The race for last opens once the first games are in."
          />
        )}
      </div>
    </section>
  );
}

/* ── Preseason ──────────────────────────────────────────────────────────── */
type PreSettings = {
  total_rosters?: number; scoring?: string; divisions?: number;
  playoff_teams?: number; playoff_week_start?: number; bench_slots?: number;
  max_keepers?: number; roster_positions?: string[];
  scoring_detail?: Record<string, number>;
};
type PreChange = { key: string; label: string; kind: string; from: string; to: string };
/* pid and owner_id are both emitted by sleeper-update.py (keepers_out) and were
   simply never declared here, which is why the name rendered as dead text. */
type PreKeeper = {
  draft_slot?: number; player: string; pos?: string; team: string;
  pid?: string | null; owner_id?: string | null;
};

function Preseason({ p, league, h }: { p: PreseasonFile; league: LeagueFile; h: HistoryFile }) {
  const s = (p.settings ?? {}) as PreSettings;
  const d = (p.draft ?? {}) as { start_time?: number; status?: string; type?: string; rounds?: number };
  const changes = (p.changes ?? []) as PreChange[];
  const keepers = (p.keepers ?? []) as PreKeeper[];
  const champ = h.seasons?.[0];
  const sd = s.scoring_detail ?? {};

  const KEY_TO_CARD: Record<string, string> = {
    bench_slots: "Bench", scoring: "Scoring", max_keepers: "Keepers",
    total_rosters: "Teams", playoff_teams: "Playoffs", playoff_week_start: "Playoffs",
  };
  const cardChange: Record<string, PreChange> = {};
  changes.forEach((c) => {
    const card = KEY_TO_CARD[c.key];
    if (card && !cardChange[card]) cardChange[card] = c;
  });

  const about: [string, string][] = [
    ["Scoring", String(s.scoring ?? "")],
    ["Teams", `${s.total_rosters ?? ""}${s.divisions ? ` · ${s.divisions} divisions` : ""}`],
    ["Playoffs", `${s.playoff_teams ?? "?"} teams · from Wk ${s.playoff_week_start ?? "?"}`],
    ["Bench", `${s.bench_slots ?? "?"} spots`],
    ["Keepers", s.max_keepers ? `${s.max_keepers} per team` : "None"],
    ["Reception", `${sd.rec ?? "—"} pt`],
  ];

  return (
    <>
      <section className="mb-10 rounded-lg border border-l-4 border-l-primary bg-card px-5 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          {String(p.season)} Season · Preseason
        </div>
        <h2 className="mt-1 text-2xl font-extrabold">{String(p.name ?? league.meta.name)}</h2>
        <div className="mt-1 text-sm text-muted-foreground">
          Draft{" "}
          <strong className="text-foreground">
            {d.start_time ? fmtDate(d.start_time) : labelStatus(d.status ?? (p.status as string))}
          </strong>
          {d.rounds ? ` · ${d.rounds} rounds` : ""} · {String(s.scoring ?? "")},{" "}
          {s.total_rosters ?? ""} teams
          {champ?.champion && (
            <>
              {" · Defending champ "}
              <strong className="text-foreground">{champ.champion}</strong>
            </>
          )}
        </div>
        {d.start_time && <DraftCountdown startMs={d.start_time} />}
      </section>

      <section className="mb-10">
        <SectionLabel sub={`${String(p.season)} season`}>League Setup</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {about.map(([l, v]) => {
            const chg = cardChange[l];
            return (
              <StatCard
                key={l}
                label={
                  chg ? (
                    <>
                      {l}
                      <span className="ml-1.5 rounded-sm bg-primary px-1 py-px font-mono text-[8px] text-primary-foreground">
                        {chg.kind}
                      </span>
                    </>
                  ) : (
                    l
                  )
                }
                value={v}
              />
            );
          })}
        </div>
        <div className="mt-3">
          <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
            Weekly starting lineup
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(s.roster_positions ?? []).map((pp, i) => (
              <span
                key={i}
                className="rounded-md border bg-secondary px-2 py-0.5 font-mono text-[11px] font-bold"
              >
                {SLOT_NAME[pp] ?? pp}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {changes.length ? (
            changes.map((c, i) => (
              <div key={i} className="rounded-lg border bg-card px-3 py-2">
                <div className="text-xs font-bold">
                  {c.label}
                  <span className="ml-1.5 rounded-sm bg-primary px-1 py-px font-mono text-[8px] text-primary-foreground">
                    {c.kind}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground line-through">{c.from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-bold">{c.to}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-[13px] text-muted-foreground">
              No rule changes from {String(p.prior_season ?? "")} — same settings carry over.
            </div>
          )}
        </div>
      </section>

      <section className="mb-10">
        <SectionLabel sub="keepers & draft order">Draft Snapshot</SectionLabel>
        <div className="mb-3 text-sm text-muted-foreground">
          {d.start_time && (
            <>
              <strong className="text-foreground">{fmtDate(d.start_time)}</strong>
              {" · "}
            </>
          )}
          {labelStatus(d.status ?? (p.status as string))}
          {d.type ? ` · ${d.type}` : ""}
          {d.rounds ? ` · ${d.rounds} rounds` : ""} · {keepers.length} keepers locked
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {keepers.length ? (
            keepers.map((k, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span className="w-6 shrink-0 text-center font-mono text-sm text-muted-foreground">
                  {k.draft_slot ?? "–"}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">
                    <PlayerLink pid={k.pid}>{k.player}</PlayerLink>
                    {k.pos && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        {k.pos}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{k.team}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Keepers not set yet.</p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link href="/draft" className="text-primary hover:underline">
            Full draft board →
          </Link>
          <Link href="/keepers" className="text-primary hover:underline">
            Keeper history →
          </Link>
        </div>
      </section>
    </>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function LeaguePage() {
  const [league, setLeague] = useState<LeagueFile | null>(null);
  const [history, setHistory] = useState<HistoryFile | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pre, setPre] = useState<PreseasonFile | null>(null);
  const [now, setNow] = useState<NowFile | null>(null);
  const [pw, setPw] = useState<Watch | null>(null);
  const [uw, setUw] = useState<Watch | null>(null);
  const [wi, setWi] = useState<WiSeason | null>(null);
  const [error, setError] = useState(false);

  /* Only now.json is polled. The watches move with it but are 40 KB each and
     nobody is refreshing a playoff-odds table between snaps; they reload with
     the page. */
  const reloadNow = useCallback(async () => {
    setNow(await fetchJSON<NowFile>("now.json"));
  }, []);

  const live = useAutoRefresh(reloadNow, {
    enabled: Boolean(now?.active) && now?.phase !== "final",
    intervalMs: now?.phase === "live" ? LIVE_MS : PRE_MS,
  });

  useEffect(() => {
    (async () => {
      try {
        const [l, h, m] = await Promise.all([
          fetchJSON<LeagueFile>("league.json"),
          fetchJSON<HistoryFile>("history.json"),
          fetchJSON<Meta>("meta.json"),
        ]);
        setLeague(l);
        setHistory(h);
        setMeta(m);

        const p = await fetchJSON<PreseasonFile>("preseason.json").catch(() => ({ active: false }));
        setPre(p);
        if (p.active) return;

        const n = await fetchJSON<NowFile>("now.json").catch(() => null);
        setNow(n);
        if (n?.active || l.meta?.status === "in_season") {
          /* Each is independent, so one 404 cannot sink the page. */
          const [a, b] = await Promise.all([
            fetchJSON<Watch>("playoff_watch.json").catch(() => null),
            fetchJSON<Watch>("punish_watch.json").catch(() => null),
          ]);
          /* The stat boards' median and luck tabs; the page stands without it. */
          fetchJSON<WhatIf>("whatif.json")
            .then((w) => setWi(w.seasons.find((x) => x.season === l.meta.season) ?? null))
            .catch(() => {});
          setPw(a);
          setUw(b);
        }
      } catch {
        setError(true);
      }
    })();
  }, []);

  if (error)
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow="Fantasy Football"
          title="League Dashboard"
          subtitle="Could not load league data."
        />
      </div>
    );

  if (!league || !history || !meta || !pre)
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow="Fantasy Football"
          title="League Dashboard"
          subtitle="Loading league data…"
        />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );

  const m = league.meta;
  const mode: Mode = pre.active
    ? "preseason"
    : now?.active || m.status === "in_season"
      ? "inseason"
      : "complete";

  const seasonsLine = `${m.total_rosters} teams · ${m.scoring} · ${meta.seasons.length} season${
    meta.seasons.length > 1 ? "s" : ""
  } on record`;

  const eyebrow =
    mode === "preseason"
      ? `Season ${String(pre.season ?? m.season)} · Preseason`
      : mode === "inseason"
        ? `Season ${m.season}${now?.active ? ` · Week ${now.week}` : ""}`
        : `Season ${m.season} · ${m.status === "complete" ? "Final" : "Live"}`;

  const cs = history.seasons?.[0];
  const eff = league.manager_efficiency as
    | { team: string; color?: string; pct: number; actual: number; optimal: number; left: number }[]
    | undefined;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10 lg:max-w-6xl">
      <PageHeader
        eyebrow={eyebrow}
        title={mode === "preseason" ? String(pre.name ?? m.name) : m.name}
        subtitle={seasonsLine}
        updated={`Updated ${relTime(meta.generated_at)}`}
      />

      {/* Three children, one grid. On mobile they simply stack in DOM order —
          lead section, X feed, everything else — which puts the feed a screen
          or so down rather than at the foot of a very long page; most of the
          traffic here is phones and nobody scrolls to the bottom of this.
          From lg the areas fold it into a right rail spanning both content
          rows. minmax(0,1fr) rather than 1fr: the standings and efficiency
          tables are overflow-x containers, and a bare 1fr track lets their
          intrinsic width push the rail off the page. */}
      {/* Below lg the feed goes last: the league's own sections outrank it. */}
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:[grid-template-areas:'top_feed'_'rest_feed']">
        <div className="min-w-0 lg:[grid-area:top]">
          {mode === "inseason" && now?.active && <Scoreboard n={now} live={live} />}
          {mode === "complete" && cs?.champion && (
            <section className="mb-10">
              <ChampionBanner
                season={cs.season}
                champion={cs.champion}
                runnerUp={cs.runner_up}
                regularSeason={cs.regular_season}
              />
            </section>
          )}
        </div>

        <div className="order-last mb-10 lg:order-none lg:mb-0 lg:[grid-area:feed]">
          <div className="lg:sticky lg:top-6">
            <SectionLabel sub="the league account, Schefter, Underdog and Rotowire">
              Around the League
            </SectionLabel>
            <TwitterFeed />
          </div>
        </div>

        <div className="min-w-0 lg:[grid-area:rest]">

      {mode === "preseason" && <Preseason p={pre} league={league} h={history} />}

      {mode === "inseason" && (
        <>
          <Standings rows={league.standings} isFinal={false} />
          <StatBoards league={league} wi={wi} midWeek={now?.phase === "live"} />
          <FunFacts league={league} wi={wi} />
          <WatchCards pw={pw} uw={uw} />
          <LeagueSetup meta={m} />
        </>
      )}

      {mode === "complete" && (
        <>
          <LeagueSetup meta={m} />
          {eff && eff.length > 0 && (
            <section className="mb-10">
              <SectionLabel sub="how close to the optimal lineup each manager set">
                Manager Efficiency
              </SectionLabel>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="w-8 px-2 py-1.5 sm:w-10 sm:px-3 sm:py-2 text-left">#</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Manager</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Efficiency</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Pts Started</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Optimal</th>
                      <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Left on Bench</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eff.map((e, i) => (
                      <tr key={e.team} className="border-b last:border-0">
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ background: e.color ?? "var(--muted-foreground)" }}
                            />
                            <span className="truncate font-bold">{e.team}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono font-bold tabular-nums">
                          {e.pct.toFixed(1)}%
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums">
                          {e.actual.toFixed(0)}
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {e.optimal.toFixed(0)}
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-bad">
                          {e.left.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <Standings rows={league.standings} isFinal />
          <section className="mb-10">
            <SectionLabel>Week {league.scoreboard.week} Results</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              {(league.scoreboard.games as {
                t1: string; t2: string; t1_pts: number; t2_pts: number; winner: string | null;
              }[]).map((g, i) => (
                <div key={i} className="rounded-lg border bg-card px-4 py-3 text-sm">
                  {[
                    [g.t1, g.t1_pts, g.winner === g.t1],
                    [g.t2, g.t2_pts, g.winner === g.t2],
                  ].map(([t, p, won], j) => (
                    <div
                      key={j}
                      className={cn(
                        "flex items-center justify-between gap-3",
                        !won && "text-muted-foreground",
                      )}
                    >
                      <span className="truncate">{t as string}</span>
                      <span className={cn("font-mono tabular-nums", won && "font-bold text-ok")}>
                        {(p as number).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {!league.scoreboard.games?.length && (
                <p className="text-sm text-muted-foreground">No completed games.</p>
              )}
            </div>
          </section>
          <Bracket winners={league.bracket.winners} />
          <PowerRankings rows={league.power_rankings} />
        </>
      )}

      <Records r={league.records} />
      <HeadToHead h2h={history.h2h} />
      <LeagueHistory h={history} />
      <LastSeason h={history} league={league} />
      {mode !== "preseason" && <Transactions tx={league.transactions ?? []} />}
        </div>
      </div>
    </div>
  );
}
