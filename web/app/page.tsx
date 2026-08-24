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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  fetchJSON, relTime,
  type DraftFile, type HistoryFile, type LeagueFile,
  type Meta, type NowFile, type NowPlayer, type NowSide, type PreseasonFile, type Watch,
} from "@/lib/data";
import { PageHeader, PlayerLink, StatCard, TeamAvatar, YouBadge } from "@/components/gggg/primitives";
import {
  Bracket, ChampionBanner, HeadToHead, LastSeason, LeagueHistory, LeagueSetup,
  PowerRankings, Records, SectionLabel, SLOT_NAME, Standings, Transactions, fmtDate,
} from "@/components/gggg/league-sections";
import { isMine, useMe } from "@/lib/me";
import { cn } from "@/lib/utils";

type Mode = "preseason" | "inseason" | "complete";

const STATUS_LABEL: Record<string, string> = {
  pre_draft: "Draft not started", drafting: "Draft in progress",
  complete: "Complete", in_season: "In season",
};
const labelStatus = (s?: string) => (s && STATUS_LABEL[s]) || s || "TBD";

const PHASE_LABEL: Record<string, string> = {
  pre: "Not started", live: "In progress", final: "Final",
};

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

/* ── In-season: this week's matchups ────────────────────────────────────── */
function Lineups({ g, slots, pre }: { g: NowFile["games"][0]; slots: string[]; pre: boolean }) {
  const val = (p: NowPlayer) => {
    if (pre) return p.proj != null ? p.proj.toFixed(1) : "—";
    /* In progress: a player yet to play shows a dimmed projection so the card
       never reads as a column of zeroes on Sunday morning. */
    if (p.pts) return p.pts.toFixed(1);
    return p.proj != null ? <span className="opacity-55">{p.proj.toFixed(1)}</span> : "0.0";
  };

  const Cell = ({ p, right }: { p?: NowPlayer; right?: boolean }) => (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        right ? "flex-row" : "flex-row-reverse text-right",
        !p && "text-muted-foreground",
      )}
    >
      {p ? (
        <>
          <span className="shrink-0 font-mono tabular-nums">{val(p)}</span>
          {p.injury && (
            <span className="shrink-0 font-mono text-[9px] text-bad" title={p.injury}>
              {p.injury[0]}
            </span>
          )}
          {p.pid ? (
            <Link
              href={{ pathname: "/player", query: { pid: p.pid } }}
              className="min-w-0 truncate hover:text-primary"
            >
              {p.nick || p.name}
            </Link>
          ) : (
            <span className="min-w-0 truncate">{p.name}</span>
          )}
        </>
      ) : (
        <span>—</span>
      )}
    </div>
  );

  const aS = g.a.players.filter((p) => p.starter);
  const bS = g.b.players.filter((p) => p.starter);
  const aB = g.a.players.filter((p) => !p.starter);
  const bB = g.b.players.filter((p) => !p.starter);
  const n = Math.max(aS.length, bS.length);
  const bn = Math.max(aB.length, bB.length);
  const at = pre ? g.a.proj : g.a.points;
  const bt = pre ? g.b.proj : g.b.points;

  const Row = ({ a, b, slot }: { a?: NowPlayer; b?: NowPlayer; slot: string }) => (
    <div className="grid items-center gap-1 border-b px-2 py-1 last:border-0 [grid-template-columns:1fr_40px_1fr] sm:[grid-template-columns:1fr_52px_1fr]">
      <Cell p={a} />
      <span className="text-center font-mono text-[9px] font-bold uppercase text-muted-foreground">
        {SLOT_NAME[slot] ?? slot}
      </span>
      <Cell p={b} right />
    </div>
  );

  return (
    <div className="border-t bg-background/40">
      {Array.from({ length: n }, (_, i) => (
        <Row
          key={i}
          a={aS[i]}
          b={bS[i]}
          slot={String(aS[i]?.slot ?? bS[i]?.slot ?? slots[i] ?? "")}
        />
      ))}
      <div className="grid items-center gap-1 border-y-2 px-2 py-1.5 font-mono font-bold [grid-template-columns:1fr_40px_1fr] sm:[grid-template-columns:1fr_52px_1fr]">
        <span className="text-right">{at.toFixed(1)}</span>
        <span className="text-center text-[9px] text-muted-foreground">
          {pre ? "PROJ" : "TOTAL"}
        </span>
        <span>{bt.toFixed(1)}</span>
      </div>
      {(aB.length > 0 || bB.length > 0) && (
        <>
          <div className="px-2 py-1 text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Bench
          </div>
          {Array.from({ length: bn }, (_, i) => (
            <Row key={`b${i}`} a={aB[i]} b={bB[i]} slot="BN" />
          ))}
        </>
      )}
    </div>
  );
}

function ThisWeek({ n }: { n: NowFile }) {
  const pre = n.phase === "pre";
  const cardVal = (s: NowSide) => (pre ? s.proj : s.points);
  const me = useMe();

  /* Your game first, in the order the builder emitted otherwise. The rest of
     the week still reads as a scoreboard — this only moves one card, which is
     the difference between scanning twelve teams for your name and not. */
  const games = useMemo(() => {
    const list = n.games ?? [];
    if (!me.ownerId) return list;
    const idx = list.findIndex((g) => isMine(me, g.a.owner_id) || isMine(me, g.b.owner_id));
    return idx <= 0 ? list : [list[idx], ...list.filter((_, i) => i !== idx)];
  }, [n.games, me]);

  const note = pre
    ? n.first_kickoff
      ? `First kickoff ${fmtDate(n.first_kickoff)}`
      : n.projections?.available
        ? "Projected totals until kickoff"
        : "Lineups lock at kickoff"
    : "Live points · projections shown for players yet to play";

  return (
    <section className="mb-10">
      <SectionLabel sub="every matchup, tap to open the lineups">This Week</SectionLabel>

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm">
        <span className="font-bold">Week {n.week}</span>
        <span
          className={cn(
            "rounded-sm px-1.5 py-px font-mono text-[10px] font-bold uppercase",
            n.phase === "live" ? "bg-ok text-background" : "bg-secondary text-muted-foreground",
          )}
        >
          {PHASE_LABEL[n.phase] ?? n.phase}
        </span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>

      {!games.length ? (
        <p className="text-sm text-muted-foreground">No matchups posted for this week yet.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {games.map((g) => {
            const av = cardVal(g.a);
            const bv = cardVal(g.b);
            const aLead = av > bv;
            const bLead = bv > av;
            const isMyGame = isMine(me, g.a.owner_id) || isMine(me, g.b.owner_id);
            const Side = ({ s, lead }: { s: NowSide; lead: boolean }) => (
              <div
                className={cn(
                  "flex items-center gap-2",
                  !lead && (aLead || bLead) && "text-muted-foreground",
                )}
              >
                <TeamAvatar src={s.avatar} name={s.team} />
                <span className="min-w-0 flex-1 truncate font-bold">{s.team}</span>
                {isMine(me, s.owner_id) && <YouBadge />}
                <span className="hidden text-xs text-muted-foreground sm:inline">{s.record}</span>
                <span className={cn("font-mono text-lg font-bold tabular-nums", lead && "text-ok")}>
                  {cardVal(s).toFixed(1)}
                </span>
              </div>
            );

            /* Before kickoff the projected win probability is the useful summary.
               Once points are on the board it is stale — it ignores what has
               already happened — so switch to the live margin instead. */
            const pa = Math.round((g.win_prob_a ?? 0.5) * 100);
            const tot = av + bv;
            const share = tot > 0 ? Math.round((av / tot) * 100) : 50;
            const diff = Math.abs(av - bv);

            return (
              <details
                key={g.matchup_id}
                /* Opens by default and keeps the accent, so your lineup is the
                   one thing on the page you do not have to go looking for. */
                open={isMyGame}
                className={cn(
                  "group rounded-lg border bg-card",
                  isMyGame && "border-primary/50 ring-1 ring-primary/20",
                )}
              >
                <summary className="cursor-pointer list-none px-4 py-3">
                  <Side s={g.a} lead={aLead} />
                  <div className="mt-1.5">
                    <Side s={g.b} lead={bLead} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {pre && (
                      <span className="w-9 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {pa}%
                      </span>
                    )}
                    <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-secondary">
                      <i
                        className="block h-full bg-primary"
                        style={{ width: `${pre ? pa : share}%` }}
                      />
                    </span>
                    <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                      {pre
                        ? `${100 - pa}%`
                        : diff < 0.05
                          ? "Tied"
                          : `${aLead ? g.a.team : g.b.team} +${diff.toFixed(1)}`}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{pre ? "Projected" : "Live"}</span>
                    <span className="group-open:hidden">Tap for lineups ▾</span>
                    <span className="hidden group-open:inline">Hide lineups ▴</span>
                  </div>
                </summary>
                <Lineups g={g} slots={n.slots ?? []} pre={pre} />
              </details>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href="/matchups" className="text-primary hover:underline">
          Full matchup browser →
        </Link>
        <Link href="/recap" className="text-primary hover:underline">
          Last week&apos;s recap →
        </Link>
      </div>
    </section>
  );
}

function DraftStrip({ d, n }: { d: DraftFile | null; n: NowFile }) {
  /* Only worth showing before the season has real results to talk about. */
  if (!d?.picks?.length || n.phase !== "pre" || String(d.meta?.season) !== String(n.season))
    return null;
  const r1 = d.picks.filter((p) => p.round === 1).sort((a, b) => a.pick - b.pick);
  if (!r1.length) return null;

  return (
    <section className="mb-10">
      <SectionLabel sub={`round 1 of the ${d.meta.season} draft`}>Off the Board</SectionLabel>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {r1.map((p) => (
          <div key={p.pick} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
            <span className="w-6 shrink-0 text-center font-mono text-sm text-muted-foreground">
              {p.pick}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">
                <PlayerLink pid={p.pid}>{p.player}</PlayerLink>
                {p.pos && (
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">{p.pos}</span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">{p.team}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href="/draft" className="text-primary hover:underline">
          Full draft board →
        </Link>
        <Link href="/teams" className="text-primary hover:underline">
          Rosters →
        </Link>
      </div>
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
      <SectionLabel sub="playoff odds &amp; the punishment race">Watch</SectionLabel>
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
        <SectionLabel sub="keepers &amp; draft order">Draft Snapshot</SectionLabel>
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
  const [draft, setDraft] = useState<DraftFile | null>(null);
  const [pw, setPw] = useState<Watch | null>(null);
  const [uw, setUw] = useState<Watch | null>(null);
  const [error, setError] = useState(false);

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
          const [d, a, b] = await Promise.all([
            fetchJSON<DraftFile>("draft.json").catch(() => null),
            fetchJSON<Watch>("playoff_watch.json").catch(() => null),
            fetchJSON<Watch>("punish_watch.json").catch(() => null),
          ]);
          setDraft(d);
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
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow={eyebrow}
        title={mode === "preseason" ? String(pre.name ?? m.name) : m.name}
        subtitle={seasonsLine}
        updated={`Updated ${relTime(meta.generated_at)}`}
      />

      {mode === "preseason" && <Preseason p={pre} league={league} h={history} />}

      {mode === "inseason" && (
        <>
          {now?.active && <ThisWeek n={now} />}
          {now?.active && <DraftStrip d={draft} n={now} />}
          <Standings rows={league.standings} isFinal={false} />
          <PowerRankings rows={league.power_rankings} />
          <WatchCards pw={pw} uw={uw} />
          <LeagueSetup meta={m} />
        </>
      )}

      {mode === "complete" && (
        <>
          {cs?.champion && (
            <section className="mb-10">
              <ChampionBanner
                season={cs.season}
                champion={cs.champion}
                runnerUp={cs.runner_up}
                regularSeason={cs.regular_season}
              />
            </section>
          )}
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
  );
}
