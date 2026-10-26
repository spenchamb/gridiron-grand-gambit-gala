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
import { PageHeader, PlayerLink, StatCard } from "@/components/gggg/primitives";
import {
  Bracket, ChampionBanner, HeadToHead, LastSeason, LeagueHistory,
  PowerRankings, Records, SectionLabel, SLOT_NAME, Standings, Transactions, fmtDate,
} from "@/components/gggg/league-sections";
import { TwitterFeed } from "@/components/gggg/twitter-feed";
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
/* One table, every lens at once, sorted by tapping a column. The rank column
   is the team's place under the current sort; when that is 3+ seats away from
   the real standings it turns green (the standings undersell them) or red
   (they oversell them). That gap is the point of the table. */
type SortKey = "wl" | "ap" | "med" | "pf" | "luck";

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: "wl", label: "W-L", title: "Record (standings order)" },
  { key: "ap", label: "AP%", title: "All-play: every score against all eleven others, every week" },
  { key: "med", label: "Med", title: "Record plus a game against the league median each week" },
  { key: "pf", label: "PF", title: "Points for" },
  { key: "luck", label: "Luck", title: "Wins above what a typical schedule would have given" },
];

function TheNumbers({ league, wi, midWeek }: { league: LeagueFile; wi: WiSeason | null; midWeek: boolean }) {
  const [sort, setSort] = useState<SortKey>("ap");
  const me = useMe();
  const med = new Map((wi?.median ?? []).map((r) => [r.team, r.record]));
  const luck = new Map((wi?.schedule_luck ?? []).map((r) => [r.team, r.luck]));
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
      <SectionLabel sub="who's actually good, and who's just lucky">The Numbers</SectionLabel>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[500px] text-sm tabular-nums">
          <thead>
            <tr className="border-b text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {/* Rank and team stay pinned while the stat columns scroll under them. */}
              <th className="sticky left-0 z-10 w-44 bg-card py-2 pl-3 pr-2 text-left font-bold sm:w-56">
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
                      sort === c.key ? "text-primary" : "hover:text-foreground",
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
                  <td className={cn("sticky left-0 z-10 w-44 max-w-44 py-2 pl-3 pr-2 sm:w-56 sm:max-w-56", mine ? "bg-[color-mix(in_oklch,var(--primary)_5%,var(--card))]" : "bg-card")}>
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
                        c.key === "luck" && r.luck != null && r.luck >= 1 && "text-ok",
                        c.key === "luck" && r.luck != null && r.luck <= -1 && "text-bad",
                      )}
                    >
                      {c.key === "wl"
                        ? `${r.s.wins}-${r.s.losses}`
                        : c.key === "ap"
                          ? Math.round(r.s.all_play_pct * 100)
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
        Tap a column to sort; swipe for more. AP% is all-play win rate; Med counts a game against the weekly median;
        Luck is wins above a typical schedule. A green or red # means the standings have that team
        3+ seats wrong.{midWeek && " All-play, Med and Luck include this week's scores so far."}
      </p>
    </section>
  );
}

/* ── Storylines ─────────────────────────────────────────────────────────── */
/* Every line is computed from the files the page already reads, so they turn
   over each week on their own. A line only appears when the numbers make it a
   story; a one-seat gap or a one-game streak is not a headline. */
type Story = { head: string; body: string };

function weekStories(r: Recap | null): Story[] {
  if (!r?.has_data) return [];
  const out: Story[] = [];
  if (r.high) out.push({ head: "Top dog", body: `${r.high.team} hung ${r.high.pts.toFixed(1)} on the board. Best in the league this week.` });
  if (r.low) out.push({ head: "Rock bottom", body: `${r.low.team} managed ${r.low.pts.toFixed(1)}. Thoughts and prayers.` });
  if (r.blowout?.winner && r.blowout.margin >= 30) {
    const loser = r.blowout.winner === r.blowout.t1 ? r.blowout.t2 : r.blowout.t1;
    out.push({ head: "Mercy rule", body: `${r.blowout.winner} beat ${loser} by ${r.blowout.margin.toFixed(1)}. Someone call it.` });
  }
  if (r.nailbiter && r.nailbiter.margin < 5) {
    out.push({ head: "Photo finish", body: `${r.nailbiter.winner} survived by ${r.nailbiter.margin.toFixed(2)}. Every decimal counted.` });
  }
  if (r.unlucky) out.push({ head: "Wrong place, wrong time", body: `${r.unlucky.team} scored ${r.unlucky.pts.toFixed(1)}, above the median, and still took the L.` });
  if (r.lucky) out.push({ head: "Stole one", body: `${r.lucky.team} won with ${r.lucky.pts.toFixed(1)}, below the median. Don't ask how.` });
  const mvp = r.top_players?.[0];
  if (mvp) out.push({ head: "Player of the week", body: `${mvp.player} (${mvp.pos}, ${mvp.nfl_team}) dropped ${mvp.pts.toFixed(1)} for ${mvp.fantasy_team}.` });
  return out;
}

function seasonStories(league: LeagueFile, wi: WiSeason | null): Story[] {
  const out: Story[] = [];
  const st = league.standings;
  if (!st.length) return out;
  const rec = (s: (typeof st)[number]) => `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`;
  const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th"}`;
  const byPf = [...st].sort((a, b) => b.pf - a.pf);
  const pfRank = (t: (typeof st)[number]) => byPf.indexOf(t) + 1;

  const robbed = [...st].sort((a, b) => (b.rank - pfRank(b)) - (a.rank - pfRank(a)))[0];
  if (robbed && robbed.rank - pfRank(robbed) >= 3) {
    out.push({
      head: "Robbed",
      body: `${robbed.team} has the ${ord(pfRank(robbed))}-most points and a ${rec(robbed)} record to show for it. ${ord(robbed.rank)} place. Cruel.`,
    });
  }
  const fraud = [...st].sort((a, b) => (pfRank(b) - b.rank) - (pfRank(a) - a.rank))[0];
  if (fraud && pfRank(fraud) - fraud.rank >= 3) {
    out.push({
      head: "Smoke and mirrors",
      body: `${fraud.team} is ${rec(fraud)} and ${ord(fraud.rank)} in the standings on the ${ord(pfRank(fraud))}-most points. Enjoy it while it lasts.`,
    });
  }

  const luck = [...(wi?.schedule_luck ?? [])].sort((a, b) => a.luck - b.luck);
  const worst = luck[0];
  if (worst && worst.luck <= -1) {
    out.push({
      head: "Schedule from hell",
      body: `${worst.team} is ${worst.actual}. Across every possible schedule they'd typically have ${worst.median_w.toFixed(0)} wins. The calendar owes them.`,
    });
  }
  const kind = luck[luck.length - 1];
  if (kind && kind.luck >= 1 && kind !== worst) {
    out.push({
      head: "Charmed life",
      body: `${kind.team} is ${kind.actual}; a typical schedule has them at ${kind.median_w.toFixed(0)} wins. Somebody's been dodging the good teams.`,
    });
  }

  const ap = [...st].sort((a, b) => b.all_play_pct - a.all_play_pct)[0];
  if (ap) {
    out.push({
      head: "Best team, no asterisk",
      body: `${ap.team} would beat ${Math.round(ap.all_play_pct * 100)}% of the league in a given week (${ap.all_play} all-play).${ap.rank > 3 ? ` They're ${ord(ap.rank)} anyway.` : ""}`,
    });
  }

  /* Streaks: the builder writes "W3" / "L2". */
  const streak = (s: (typeof st)[number]) => {
    const m = /^([WL])(\d+)$/.exec(s.streak ?? "");
    return m ? { kind: m[1], n: Number(m[2]) } : null;
  };
  const hot = st.map((s) => ({ s, k: streak(s) })).filter((x) => x.k?.kind === "W").sort((a, b) => b.k!.n - a.k!.n)[0];
  if (hot && hot.k!.n >= 3) out.push({ head: "Heater", body: `${hot.s.team} has won ${hot.k!.n} straight. Somebody stop them.` });
  const cold = st.map((s) => ({ s, k: streak(s) })).filter((x) => x.k?.kind === "L").sort((a, b) => b.k!.n - a.k!.n)[0];
  if (cold && cold.k!.n >= 3) out.push({ head: "Freefall", body: `${cold.s.team} has dropped ${cold.k!.n} in a row.` });

  const games = (s: (typeof st)[number]) => s.wins + s.losses + s.ties;
  const winless = st.find((s) => s.wins === 0 && games(s) >= 3);
  if (winless) out.push({ head: "Still looking", body: `${winless.team} is ${rec(winless)}. Win number one is out there somewhere.` });
  const perfect = st.find((s) => s.losses === 0 && games(s) >= 3);
  if (perfect) out.push({ head: "Unblemished", body: `${perfect.team} hasn't lost yet at ${rec(perfect)}.` });

  const bag = [...st].sort((a, b) => b.pa - a.pa)[0];
  if (bag) out.push({ head: "Punching bag", body: `${bag.team} has had ${bag.pa.toFixed(1)} points scored on them, most in the league. Opponents save their best weeks for them.` });

  const eff = league.manager_efficiency as { team: string; pct: number; left: number }[] | undefined;
  const bench = eff?.length ? [...eff].sort((a, b) => b.left - a.left)[0] : null;
  if (bench && bench.left > 0) {
    out.push({ head: "Wrong guys", body: `${bench.team} has left ${bench.left.toFixed(1)} points on the bench, the most in the league. Lineups are hard.` });
  }

  const hi = league.records?.highest_score as { team?: string; pts?: number; week?: number; season?: string } | undefined;
  if (hi?.season === league.meta.season && hi.team && hi.pts != null) {
    out.push({ head: "Record book", body: `${hi.team} put up ${hi.pts.toFixed(2)} in week ${hi.week}, the most in league history.` });
  }
  return out;
}

function Storylines({ league, wi, recap, live }: { league: LeagueFile; wi: WiSeason | null; recap: Recap | null; live: boolean }) {
  const week = weekStories(recap);
  const season = seasonStories(league, wi);
  if (!week.length && !season.length) return null;
  const Group = ({ title, items }: { title: string; items: Story[] }) =>
    items.length ? (
      <div className="mb-6">
        <h3 className="mb-2 font-brand text-lg tracking-tight">{title}</h3>
        <ul className="overflow-hidden rounded-lg border bg-card">
          {items.map((f) => (
            <li key={f.head} className="border-b px-4 py-3 last:border-b-0">
              <span className="font-bold">{f.head}.</span>{" "}
              <span className="text-muted-foreground">{f.body}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <section className="mb-10">
      <SectionLabel sub="what the numbers are saying">Storylines</SectionLabel>
      <Group title={`Week ${recap?.week ?? ""}${live ? ", so far" : ""}`} items={week} />
      <Group title="The season" items={season} />
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
          <TheNumbers league={league} wi={wi} midWeek={now?.phase === "live"} />
          <Storylines
            league={league}
            wi={wi}
            recap={recap}
            live={now?.phase === "live" && recap?.week === now.week}
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
