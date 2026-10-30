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
  type Meta, type NowFile, type NowSide, type PreseasonFile, type Watch, type Recap, type WhatIf, type WiSeason,
} from "@/lib/data";
import { PageHeader, PlayerLink, StatCard, TeamAvatar } from "@/components/gggg/primitives";
import {
  Bracket, ChampionBanner, HeadToHead, LastSeason, LeagueHistory,
  PowerRankings, Records, SectionLabel, SLOT_NAME, Standings, Transactions, fmtDate,
} from "@/components/gggg/league-sections";
import { TwitterFeed } from "@/components/gggg/twitter-feed";
import { PowerChart } from "@/components/gggg/power-chart";
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
    return <div className="mt-3 font-brand text-lg">Draft is live</div>;

  const days = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hrs = Math.floor(diff / 3600000); diff -= hrs * 3600000;
  const mins = Math.floor(diff / 60000); diff -= mins * 60000;
  const secs = Math.floor(diff / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="mt-3 flex items-end gap-3" aria-live="polite">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        Draft in
      </span>
      {([[days, "days"], [pad(hrs), "hrs"], [pad(mins), "min"], [pad(secs), "sec"]] as const).map(
        ([v, l]) => (
          <div key={l} className="text-center">
            <span className="block font-mono text-xl font-bold tabular-nums">{v}</span>
            <span className="block font-mono text-[11px] uppercase text-muted-foreground">{l}</span>
          </div>
        ),
      )}
    </div>
  );
}

/* ── In-season: this week's scores, compact ─────────────────────────────── */
/* The hub is a standings-and-stats page; nobody watches lineups from here
   during the window. Each matchup is two single-line rows, and the full lineup
   view lives on the Matchups page the row links to. */

/* One dot per starter: tan = game over, pulsing green = on the field now,
   hollow = yet to play. Starters only: the bench does not score, so it is never
   counted, and the dots are per team because "N to go" summed across both
   lineups said nothing about either one. */
function Pips({ s, mine }: { s: NowSide; mine: boolean }) {
  if (s.to_play == null) return null;
  const done = s.played ?? 0;
  const on = s.in_play ?? 0;
  const to = s.to_play ?? 0;
  return (
    <span
      role="img"
      aria-label={`Starters: ${done} finished, ${on} playing now, ${to} yet to play`}
      className="flex shrink-0 gap-px @md:gap-0.5"
    >
      {Array.from({ length: done + on + to }, (_, i) => (
        <i
          key={i}
          className={cn(
            "size-[5px] rounded-full @md:size-1.5",
            i < done ? (mine ? "bg-primary" : "bg-foreground/70") : i < done + on ? "animate-pulse bg-ok" : "border border-muted-foreground/50",
          )}
        />
      ))}
    </span>
  );
}

function Scoreboard({ n, live }: { n: NowFile; live: AutoRefresh }) {
  const pre = n.phase === "pre";
  const me = useMe();
  const games = n.games ?? [];
  if (!games.length) return null;

  /* Before kickoff there is nothing to score, so the projection is the number. */
  const shown = (s: NowSide) => (pre ? s.proj : s.points);

  const Row = ({ s, lead, dim }: { s: NowSide; lead: boolean; dim: boolean }) => (
    <div className="flex items-center gap-1.5">
      <TeamAvatar src={s.avatar} name={s.team} className={cn("size-5", dim && "opacity-60")} />
      <span className="min-w-0 flex-1 truncate">
        <span className={cn(lead && "font-bold", dim && "text-muted-foreground", isMine(me, s.owner_id) && "text-primary")}>{s.team}</span>{" "}
        <span className="text-xs text-muted-foreground tabular-nums">{s.record}</span>
      </span>
      {!pre && <Pips s={s} mine={isMine(me, s.owner_id)} />}
      <span className={cn("w-10 shrink-0 text-right text-base tabular-nums @md:w-11", lead ? "font-brand text-foreground" : "text-muted-foreground")}>
        {shown(s).toFixed(1)}
      </span>
      {!pre && (
        <span
          className="w-7 shrink-0 text-xs text-muted-foreground tabular-nums @md:w-10"
          aria-label={`Sleeper projection ${s.proj.toFixed(1)}`}
        >
          {/* A whole number on a phone, where the team name needs the room. */}
          <span className="@md:hidden">/{s.proj.toFixed(0)}</span>
          <span className="hidden @md:inline">/{s.proj.toFixed(1)}</span>
        </span>
      )}
    </div>
  );

  return (
    <section className="@container mb-10">
      <div className="flex items-start justify-between gap-3">
        <SectionLabel sub={pre ? "projected · lineups lock at kickoff" : "tap a game for lineups"}>
          {`Week ${n.week}`}
        </SectionLabel>
        <LiveBadge live={live} refresh={n.phase !== "final"} className="shrink-0" />
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border bg-card text-sm @2xl:grid-cols-2">
        {games.map((g) => {
          const av = shown(g.a);
          const bv = shown(g.b);
          const mine = isMine(me, g.a.owner_id) || isMine(me, g.b.owner_id);
          return (
            <li key={g.matchup_id} className="border-b @2xl:odd:border-r">
              <Link
                href="/matchups"
                className={cn("block space-y-1 px-3 py-2.5 hover:bg-accent/40", mine && "bg-primary/5")}
              >
                <Row s={g.a} lead={av > bv} dim={bv > av} />
                <Row s={g.b} lead={bv > av} dim={av > bv} />
              </Link>
            </li>
          );
        })}
      </ul>
      {!pre && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            Starters
            <i className="size-1.5 rounded-full bg-foreground/70" /> done
            <i className="size-1.5 animate-pulse rounded-full bg-ok" /> playing
            <i className="size-1.5 rounded-full border border-muted-foreground/50" /> to come
          </span>
          <span>/ Sleeper&apos;s projection</span>
        </p>
      )}
    </section>
  );
}

/* ── In-season: the numbers behind the standings ────────────────────────── */
/* One table, every lens at once, sorted by tapping a column. The rank column
   is the team's place under the current sort; when that is 3+ seats away from
   the real standings it turns green (the standings undersell them) or red
   (they oversell them). That gap is the point of the table. */
type SortKey = "wl" | "ap" | "med" | "pf" | "luck";

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: "wl", label: "W-L", title: "Record (standings order)" },
  { key: "ap", label: "All-Play", title: "All-play: every score against all eleven others, every week" },
  { key: "med", label: "Med", title: "Record plus a game against the league median each week" },
  { key: "pf", label: "PF", title: "Points for" },
  { key: "luck", label: "Luck", title: "Wins above what a typical schedule would have given" },
];

function TheNumbers({ league, wi }: { league: LeagueFile; wi: WiSeason | null }) {
  const [sort, setSort] = useState<SortKey>("ap");
  const me = useMe();
  const med = new Map((wi?.median ?? []).map((r) => [r.team, r.record]));
  const luck = new Map((wi?.schedule_luck ?? []).map((r) => [r.team, r.luck]));
  /* Records, points, all-play, median and luck all stop at the last finished week. */
  const through = Math.max(0, ...league.standings.map((r) => r.wins + r.losses + r.ties));
  const cols = COLS.filter((c) => (c.key !== "med" || med.size) && (c.key !== "luck" || luck.size));

  const rows = league.standings.map((s) => ({
    s,
    med: med.get(s.team),
    medW: Number(med.get(s.team)?.split("-")[0] ?? -1),
    luck: luck.get(s.team),
  }));
  const val = (r: (typeof rows)[number]) =>
    sort === "wl" ? -r.s.rank : sort === "ap" ? r.s.all_play_pct : sort === "med" ? r.medW : sort === "pf" ? r.s.pf : (r.luck ?? -99);
  rows.sort((a, b) => val(b) - val(a) || a.s.rank - b.s.rank);

  return (
    <section className="mb-10">
      <SectionLabel>The Power Rankings</SectionLabel>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[500px] text-sm tabular-nums">
          <thead>
            <tr className="border-b text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {/* Rank and team stay pinned while the stat columns scroll under them. */}
              <th className="sticky left-0 z-10 w-44 bg-card py-2 pl-3 pr-2 text-left font-bold sm:w-56 shadow-[inset_0_-1px_0_var(--border)]">
                # · Team
              </th>
              {cols.map((c) => (
                <th key={c.key} className="px-1 py-1 text-right font-bold" aria-sort={sort === c.key ? "descending" : undefined}>
                  <button
                    type="button"
                    title={c.title}
                    onClick={() => setSort(c.key)}
                    className={cn(
                      "min-h-8 rounded-sm px-1 uppercase tracking-wider",
                      sort === c.key ? "text-foreground" : "hover:text-foreground",
                    )}
                  >
                    {c.label}
                    {sort === c.key && <span aria-hidden> ↓</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const gap = r.s.rank - (i + 1);
              const mine = isMine(me, r.s.owner_id);
              return (
                <tr key={r.s.team} className={cn("border-b last:border-b-0", mine && "bg-primary/5")}>
                  <td className={cn("sticky left-0 z-10 w-44 max-w-44 py-2 pl-3 pr-2 sm:w-56 sm:max-w-56 shadow-[inset_0_-1px_0_var(--border)]", mine ? "bg-[color-mix(in_oklch,var(--primary)_5%,var(--card))]" : "bg-card")}>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          "w-4 shrink-0 text-right text-xs",
                          sort === "wl" || Math.abs(gap) < 3 ? "text-muted-foreground" : gap > 0 ? "font-bold text-ok" : "font-bold text-bad",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className={cn("truncate font-bold", mine && "text-primary")}>{r.s.team}</span>
                    </div>
                  </td>
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "whitespace-nowrap px-2 py-2 text-right",
                        sort === c.key ? "font-bold" : "text-muted-foreground",
                        c.key === "wl" && (r.s.wins > r.s.losses ? "text-ok" : r.s.wins < r.s.losses ? "text-bad" : ""),
                        c.key === "luck" && r.luck != null && r.luck >= 1 && "text-ok",
                        c.key === "luck" && r.luck != null && r.luck <= -1 && "text-bad",
                      )}
                    >
                      {c.key === "wl"
                        ? `${r.s.wins}-${r.s.losses}`
                        : c.key === "ap"
                          ? r.s.all_play
                          : c.key === "med"
                            ? r.med ?? "—"
                            : c.key === "pf"
                              ? r.s.pf.toFixed(0)
                              : r.luck == null ? "—" : `${r.luck > 0 ? "+" : ""}${r.luck.toFixed(0)}`}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Tap a column to sort; swipe for more. All-Play is your record if you played every team every week; Med counts a game against the weekly median;
        Luck is wins above a typical schedule. A green or red # means the standings have that team
        3+ seats wrong. Through week {through}; games in progress count once they finish.
      </p>
      {league.power_history && <PowerChart history={league.power_history} />}
    </section>
  );
}

/* ── Storylines ─────────────────────────────────────────────────────────── */
/* Written from the files the page already reads, so the set turns over every
   week on its own. Every candidate carries a drama score and only the top five
   run, the best of them as a headline. Each kind has several phrasings and the
   week number picks one, so a line does not read the same two weeks running.
   Teams take plural verbs, the way a sports desk writes them. */
type Story = { id: string; drama: number; text: React.ReactNode };

const Tm = ({ n }: { n: string }) => <strong className="font-bold text-foreground">{n}</strong>;

function buildStories(
  league: LeagueFile, wi: WiSeason | null, recap: Recap | null, uw: Watch | null, wk: number,
): Story[] {
  const out: Story[] = [];
  const say = (id: string, drama: number, ...variants: React.ReactNode[]) =>
    out.push({ id, drama, text: variants[wk % variants.length] });
  const st = league.standings;
  if (!st.length) return out;
  const rec = (s: (typeof st)[number]) => `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`;
  const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th"}`;
  const f1 = (n: number) => n.toFixed(1);
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const gp = (s: (typeof st)[number]) => s.wins + s.losses + s.ties;

  /* The punishment: the league's own story, so it leads whenever it is live. */
  if (uw?.ready && uw.teams?.length) {
    const [a, b] = [...uw.teams].sort((x, y) => (x.punish_rank ?? 99) - (y.punish_rank ?? 99));
    const pa = a.punish_prob ?? 0;
    const locked = uw.teams.every((t) => t.games_left === 0);
    if (locked) {
      say("punish", 120,
        <><Tm n={a.team} /> finished last at {a.wins}-{a.losses}. The punishment is theirs.</>);
    } else if (pa >= 0.25) {
      say("punish", 100 * pa + 10,
        <><Tm n={a.team} /> sit at {a.wins}-{a.losses} with a {pct(pa)} chance of taking the punishment.</>,
        <>The punishment is looking like <Tm n={a.team} />&apos;s: {pct(pa)} to finish last at {a.wins}-{a.losses}.</>,
        <><Tm n={a.team} /> ({a.wins}-{a.losses}) have {a.games_left} games left and {pct(pa)} odds on the punishment.</>);
    }
    const pb = b?.punish_prob ?? 0;
    if (b && !locked && pb >= 0.1) {
      say("punish2", 80 * pb,
        <><Tm n={b.team} /> are next in line for the punishment at {pct(pb)}.</>,
        <>Not safe yet: <Tm n={b.team} />, {pct(pb)} to finish last.</>);
    }
  }

  /* Last finished week, from the recap. */
  const games = (recap?.has_data ? recap.games ?? [] : []).filter((g) => g.winner);
  const loser = (g: (typeof games)[number]) => (g.winner === g.t1 ? g.t2 : g.t1);
  const winPts = (g: (typeof games)[number]) => (g.winner === g.t1 ? g.t1_pts : g.t2_pts);
  const losePts = (g: (typeof games)[number]) => (g.winner === g.t1 ? g.t2_pts : g.t1_pts);
  const blow = [...games].sort((x, y) => y.margin - x.margin)[0];
  if (blow && blow.margin >= 30) {
    say("blowout", blow.margin,
      <><Tm n={blow.winner!} /> beat <Tm n={loser(blow)} /> {f1(winPts(blow))} to {f1(losePts(blow))}. The game was over early.</>,
      <>{f1(blow.margin)} points separated <Tm n={blow.winner!} /> from <Tm n={loser(blow)} />, the widest gap of the week.</>,
      <><Tm n={loser(blow)} /> lost by {f1(blow.margin)} to <Tm n={blow.winner!} />. Nothing to be done about that one.</>);
  }
  const close = [...games].sort((x, y) => x.margin - y.margin)[0];
  if (close && close.margin < 5) {
    say("closest", 60 - close.margin * 5,
      <><Tm n={close.winner!} /> edged <Tm n={loser(close)} /> by {close.margin.toFixed(2)}.</>,
      <>{close.margin.toFixed(2)} points decided <Tm n={close.winner!} /> over <Tm n={loser(close)} />.</>);
  }
  if (recap?.has_data && recap.median != null) {
    if (recap.unlucky) {
      say("unlucky", 45,
        <><Tm n={recap.unlucky.team} /> scored {f1(recap.unlucky.pts)}, over the week&apos;s median of {f1(recap.median)}, and still lost.</>,
        <>Above the median ({f1(recap.median)}) and beaten anyway: <Tm n={recap.unlucky.team} /> with {f1(recap.unlucky.pts)}.</>);
    }
    if (recap.lucky) {
      say("lucky", 40,
        <><Tm n={recap.lucky.team} /> won on {f1(recap.lucky.pts)}, under the median of {f1(recap.median)}.</>,
        <>A win on {f1(recap.lucky.pts)} for <Tm n={recap.lucky.team} />, below the week&apos;s median.</>);
    }
  }
  if (recap?.high) {
    say("high", 35,
      <><Tm n={recap.high.team} /> had the week&apos;s top score: {f1(recap.high.pts)}.</>,
      <>High score of the week went to <Tm n={recap.high.team} />, {f1(recap.high.pts)}.</>);
  }
  if (recap?.low) {
    say("low", 30,
      <><Tm n={recap.low.team} /> posted the week&apos;s low: {f1(recap.low.pts)}.</>,
      <>Low score of the week: <Tm n={recap.low.team} />, {f1(recap.low.pts)}.</>);
  }
  const mvp = recap?.top_players?.[0];
  if (mvp) {
    say("mvp", 25,
      <>{mvp.player} ({mvp.pos}, {mvp.nfl_team}) led every scorer in the league with {f1(mvp.pts)} for <Tm n={mvp.fantasy_team} />.</>,
      <><Tm n={mvp.fantasy_team} /> got {f1(mvp.pts)} out of {mvp.player}, the week&apos;s best individual score.</>);
  }

  /* The season so far. */
  const byPf = [...st].sort((a, b) => b.pf - a.pf);
  const pfRank = (t: (typeof st)[number]) => byPf.indexOf(t) + 1;
  const robbed = [...st].sort((a, b) => (b.rank - pfRank(b)) - (a.rank - pfRank(a)))[0];
  if (robbed && robbed.rank - pfRank(robbed) >= 3) {
    const gap = robbed.rank - pfRank(robbed);
    say("robbed", 20 + gap * 6,
      <><Tm n={robbed.team} /> have the {ord(pfRank(robbed))}-most points in the league and a {rec(robbed)} record. They sit {ord(robbed.rank)}.</>,
      <>Points say {ord(pfRank(robbed))}, the standings say {ord(robbed.rank)}: <Tm n={robbed.team} /> ({rec(robbed)}).</>);
  }
  const fraud = [...st].sort((a, b) => (pfRank(b) - b.rank) - (pfRank(a) - a.rank))[0];
  if (fraud && pfRank(fraud) - fraud.rank >= 3) {
    const gap = pfRank(fraud) - fraud.rank;
    say("fraud", 20 + gap * 5,
      <><Tm n={fraud.team} /> are {ord(fraud.rank)} at {rec(fraud)} on the {ord(pfRank(fraud))}-most points.</>,
      <>{rec(fraud)} and {ord(fraud.rank)} for <Tm n={fraud.team} />, with only the {ord(pfRank(fraud))}-best scoring behind it.</>);
  }

  const luck = [...(wi?.schedule_luck ?? [])].sort((a, b) => a.luck - b.luck);
  const worst = luck[0];
  if (worst && worst.luck <= -1) {
    say("unluckySchedule", 25 + Math.abs(worst.luck) * 10,
      <><Tm n={worst.team} /> are {worst.actual}. Across every possible schedule they would typically have {worst.median_w.toFixed(0)} wins.</>,
      <>The schedule has cost <Tm n={worst.team} />: {worst.actual} now, {worst.median_w.toFixed(0)} wins on a typical draw.</>);
  }
  const kind = luck[luck.length - 1];
  if (kind && kind.luck >= 1 && kind !== worst) {
    say("kindSchedule", 25 + kind.luck * 10,
      <><Tm n={kind.team} /> are {kind.actual}; a typical schedule would have them at {kind.median_w.toFixed(0)} wins.</>,
      <>Most of <Tm n={kind.team} />&apos;s {kind.actual} comes from who they have played: {kind.median_w.toFixed(0)} wins is typical.</>);
  }

  const ap = [...st].sort((a, b) => b.all_play_pct - a.all_play_pct)[0];
  if (ap) {
    say("allplay", 30,
      <><Tm n={ap.team} /> would beat {Math.round(ap.all_play_pct * 100)}% of the league in any given week ({ap.all_play} all-play).{ap.rank > 3 ? ` They are ${ord(ap.rank)} anyway.` : ""}</>,
      <>Best week-in, week-out team: <Tm n={ap.team} />, {ap.all_play} against everyone.</>);
  }

  const streak = (s: (typeof st)[number]) => {
    const m = /^([WL])(\d+)$/.exec(s.streak ?? "");
    return m ? { kind: m[1], n: Number(m[2]) } : null;
  };
  const hot = st.map((s) => ({ s, k: streak(s) })).filter((x) => x.k?.kind === "W").sort((a, b) => b.k!.n - a.k!.n)[0];
  if (hot && hot.k!.n >= 3) {
    say("hot", 20 + hot.k!.n * 5,
      <><Tm n={hot.s.team} /> have won {hot.k!.n} straight.</>,
      <>{hot.k!.n} wins in a row for <Tm n={hot.s.team} />.</>);
  }
  const cold = st.map((s) => ({ s, k: streak(s) })).filter((x) => x.k?.kind === "L").sort((a, b) => b.k!.n - a.k!.n)[0];
  if (cold && cold.k!.n >= 3) {
    say("cold", 20 + cold.k!.n * 5,
      <><Tm n={cold.s.team} /> have dropped {cold.k!.n} in a row.</>,
      <>{cold.k!.n} straight losses for <Tm n={cold.s.team} />.</>);
  }
  const winless = st.find((s) => s.wins === 0 && gp(s) >= 3);
  if (winless) say("winless", 50, <><Tm n={winless.team} /> are still looking for win number one ({rec(winless)}).</>);
  const perfect = st.find((s) => s.losses === 0 && gp(s) >= 3);
  if (perfect) say("perfect", 50, <><Tm n={perfect.team} /> have not lost yet ({rec(perfect)}).</>);

  const eff = league.manager_efficiency as { team: string; pct: number; left: number }[] | undefined;
  const bench = eff?.length ? [...eff].sort((a, b) => b.left - a.left)[0] : null;
  if (bench && bench.left > 0) {
    say("bench", 15 + bench.left / 10,
      <><Tm n={bench.team} /> have left {f1(bench.left)} points on the bench this season, the most in the league.</>,
      <>{f1(bench.left)} bench points that never made a lineup: <Tm n={bench.team} />, a league high.</>);
  }
  const hi = league.records?.highest_score as { team?: string; pts?: number; week?: number; season?: string } | undefined;
  if (hi?.season === league.meta.season && hi.team && hi.pts != null) {
    say("record", 55,
      <><Tm n={hi.team} /> put up {hi.pts.toFixed(2)} in week {hi.week}, the most in league history.</>);
  }
  const bag = [...st].sort((a, b) => b.pa - a.pa)[0];
  if (bag) say("bag", 12, <>Opponents have scored {f1(bag.pa)} on <Tm n={bag.team} />, the most in the league.</>);
  return out;
}

function Storylines({
  league, wi, recap, uw, open,
}: { league: LeagueFile; wi: WiSeason | null; recap: Recap | null; uw: Watch | null; open: boolean }) {
  /* A recap for the week still being played is partial scores, not results (an
     unplayed team reads as 0.0), so claims are only made about a finished week.
     The builder already stops at the last finished week; this guards against a
     stale or older recap.json that has not caught up. */
  const through = Math.max(0, ...league.standings.map((r) => r.wins + r.losses + r.ties));
  const stories = buildStories(league, wi, open ? null : recap, uw, through)
    .sort((a, b) => b.drama - a.drama)
    .slice(0, 5);
  if (!stories.length) return null;
  const [lead, ...rest] = stories;
  return (
    <section className="mb-10">
      <SectionLabel sub={through ? `After week ${through}` : undefined}>Storylines</SectionLabel>
      <p className="font-brand text-2xl leading-snug tracking-tight sm:text-3xl">{lead.text}</p>
      {rest.length > 0 && (
        <ul className="mt-5 divide-y border-y">
          {rest.map((s) => (
            <li key={s.id} className="py-3 text-[15px] leading-snug text-muted-foreground">
              {s.text}
            </li>
          ))}
        </ul>
      )}
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
    href, head, rows, empty, loud,
  }: { href: string; head: string; rows: [string, string][]; empty: string; loud?: boolean }) => (
    <Link
      href={href}
      className="rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40"
    >
      <div className="mb-2 font-brand text-base tracking-tight">
        {head}
      </div>
      {rows.length ? (
        rows.map(([a, b], i) => (
          <div key={a} className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
            <span className="truncate">{a}</span>
            {/* The league's one loud number: the leader's odds of the punishment. */}
            {loud && i === 0 ? (
              <span className="font-brand text-2xl leading-none text-punish">{b}</span>
            ) : (
              <span className="font-mono tabular-nums">{b}</span>
            )}
          </div>
        ))
      ) : (
        <div className="text-xs text-muted-foreground">{empty}</div>
      )}
    </Link>
  );

  return (
    <section className="mb-10">
      <SectionLabel>Playoff and punishment odds</SectionLabel>
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
            loud
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
      <section className="mb-10 rounded-lg border bg-card px-5 py-4">
        <div className="text-sm text-muted-foreground">{String(p.season)} season, preseason</div>
        <h2 className="mt-0.5 font-brand text-2xl tracking-tight">{String(p.name ?? league.meta.name)}</h2>
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
        <SectionLabel>League Setup</SectionLabel>
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
                      <span className="ml-1.5 rounded-sm bg-primary px-1 py-px font-mono text-[11px] text-primary-foreground">
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
                  <span className="ml-1.5 rounded-sm bg-primary px-1 py-px font-mono text-[11px] text-primary-foreground">
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
        <SectionLabel>Draft Snapshot</SectionLabel>
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
                      <span className="ml-1 font-mono text-[11px] text-muted-foreground">
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
  const [recap, setRecap] = useState<Recap | null>(null);
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
          fetchJSON<Recap>("recap.json").then(setRecap).catch(() => {});
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
          title="League Dashboard"
          subtitle="Could not load league data."
        />
      </div>
    );

  if (!league || !history || !meta || !pre)
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
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
        title={mode === "preseason" ? String(pre.name ?? m.name) : m.name}
        subtitle={`${eyebrow} · ${seasonsLine}`}
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
          <TheNumbers league={league} wi={wi} />
          <Storylines
            league={league}
            wi={wi}
            recap={recap}
            uw={uw}
            open={Boolean(now?.active) && now?.phase !== "final" && recap?.week === now?.week}
          />
          <WatchCards pw={pw} uw={uw} />
        </>
      )}

      {mode === "complete" && (
        <>
          {eff && eff.length > 0 && (
            <section className="mb-10">
              <SectionLabel sub="how close to the optimal lineup each manager set">
                Manager Efficiency
              </SectionLabel>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
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
