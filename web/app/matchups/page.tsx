"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  fetchJSON, relTime,
  type BoxGame, type BoxPlayer, type BoxSide, type MatchupSeason, type Meta,
} from "@/lib/data";
import { Headshot, PageHeader, PlayerLink } from "@/components/gggg/primitives";
import { Odometer, PositionalBattle, ResultBadge } from "@/components/gggg/viz";
import { storedOwnerId } from "@/lib/me";
import { cn } from "@/lib/utils";

const slotLabel = (s: string) =>
  ({ WRRB_FLEX: "W/R", REC_FLEX: "W/T", SUPER_FLEX: "SFLX" })[s] ?? s;

/* Full name only. The box score used to print the nickname *and* the real name
   beside it, which on a phone meant two strings competing for about 68px and
   both of them clipped. The nickname lives on the player page, where there is
   room for it. */
function PlayerName({ p }: { p: BoxPlayer }) {
  return <PlayerLink pid={p.pid}>{p.name}</PlayerLink>;
}

function BoxScore({ me, ot }: { me: BoxSide; ot: BoxSide }) {
  const meStart = me.players.filter((p) => p.starter);
  const otStart = ot.players.filter((p) => p.starter);
  const tie = me.points === ot.points;
  const meWin = me.points > ot.points;
  const margin = Math.abs(me.points - ot.points).toFixed(1);
  const rows = Math.max(meStart.length, otStart.length);

  const bench = (side: BoxSide) =>
    side.players
      .filter((p) => !p.starter)
      .sort((x, y) => y.pts - x.pts)
      .map((p) => `${p.name} ${p.pts.toFixed(1)}`)
      .join(" · ") || "—";

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-3.5 text-center">
        <ResultBadge kind={tie ? "t" : meWin ? "w" : "l"}>
          {tie ? "Tie" : meWin ? "Won" : "Lost"} by {margin}
        </ResultBadge>
      </div>

      {/* Scoreboard.
          Below sm this is two full-width rows rather than name/score/name
          across, because three columns on a 343px card left the team names
          about 120px each and clipped most of them. Stacked, a name gets the
          whole width and the score still reads as the headline. */}
      <div className="mb-2 sm:hidden">
        {([[me, meWin], [ot, !meWin]] as const).map(([s, lead], i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: s.color ?? "var(--muted-foreground)" }}
            />
            <span className="min-w-0 flex-1 font-bold leading-tight">{s.team}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              opt {s.optimal.toFixed(1)}
            </span>
            <span
              className={cn(
                "shrink-0 font-mono text-xl font-bold tabular-nums",
                lead && !tie ? "text-ok" : "text-muted-foreground",
              )}
            >
              <Odometer value={s.points} />
            </span>
          </div>
        ))}
      </div>

      <div className="mb-1 hidden items-center gap-2 sm:grid [grid-template-columns:1fr_auto_1fr]">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: me.color ?? "var(--muted-foreground)" }}
          />
          <span className="truncate font-bold">{me.team}</span>
        </div>
        <div className="text-center">
          <span className={cn("text-2xl font-bold", meWin && !tie ? "text-ok" : "text-muted-foreground")}>
            <Odometer value={me.points} />
          </span>
          <span className="mx-1 text-muted-foreground">–</span>
          <span className={cn("text-2xl font-bold", !meWin && !tie ? "text-ok" : "text-muted-foreground")}>
            <Odometer value={ot.points} />
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <span className="truncate font-bold">{ot.team}</span>
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: ot.color ?? "var(--muted-foreground)" }}
          />
        </div>
      </div>

      <div className="mb-2 hidden gap-2 text-center text-[11px] text-muted-foreground sm:grid [grid-template-columns:1fr_50px_1fr]">
        <span>optimal {me.optimal.toFixed(1)}</span>
        <span />
        <span>optimal {ot.optimal.toFixed(1)}</span>
      </div>

      {Array.from({ length: rows }, (_, i) => {
        const a = meStart[i];
        const b = otStart[i];
        const aHi = a && b && a.pts > b.pts;
        const bHi = a && b && b.pts > a.pts;
        return (
          /* The head-to-head pairing is the whole point of a box score, so the
             three columns survive on a phone — what goes is everything else
             competing for the width. Headshots are decoration here and cost
             ~36px a side; the slot column drops to 30px. That buys the name
             roughly 68px -> 118px, and it wraps to a second line instead of
             clipping, which is why the row height is a minimum, not fixed. */
          <div
            key={i}
            className="grid items-start gap-1.5 border-b py-1.5 text-[13px] last:border-0 sm:items-center sm:gap-2 sm:text-sm [grid-template-columns:1fr_30px_1fr] sm:[grid-template-columns:1fr_46px_1fr]"
          >
            <div className="flex min-w-0 items-start justify-end gap-1.5 text-right sm:items-center sm:gap-2">
              {a && (
                <>
                  <span className={cn("shrink-0 font-mono tabular-nums", aHi && "font-bold text-ok")}>
                    {a.pts.toFixed(1)}
                  </span>
                  <Headshot
                    pid={a.pid}
                    pos={a.pos}
                    nflTeam={a.nfl_team}
                    className="order-first hidden sm:block"
                  />
                  <span className="min-w-0 leading-snug">
                    <PlayerName p={a} />
                  </span>
                </>
              )}
            </div>
            <div className="pt-px text-center font-mono text-[10px] font-bold uppercase leading-snug text-muted-foreground">
              {slotLabel((a ?? b)?.slot ?? "")}
            </div>
            <div className="flex min-w-0 items-start gap-1.5 sm:items-center sm:gap-2">
              {b && (
                <>
                  <span className={cn("shrink-0 font-mono tabular-nums", bHi && "font-bold text-ok")}>
                    {b.pts.toFixed(1)}
                  </span>
                  <Headshot
                    pid={b.pid}
                    pos={b.pos}
                    nflTeam={b.nfl_team}
                    className="hidden sm:block"
                  />
                  <span className="min-w-0 leading-snug">
                    <PlayerName p={b} />
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}

      <div className="mt-1 grid items-center gap-1.5 border-t-2 pt-2 font-mono font-bold sm:gap-2 [grid-template-columns:1fr_30px_1fr] sm:[grid-template-columns:1fr_46px_1fr]">
        <div className="text-right">{me.points.toFixed(1)}</div>
        <div className="text-center text-[10px] uppercase text-muted-foreground">Tot</div>
        <div>{ot.points.toFixed(1)}</div>
      </div>

      <PositionalBattle me={me} ot={ot} />

      {/* Benches were one long run-on line per side. As a labelled block with
          the names wrapping, the same content reads without a horizontal
          squeeze and the team it belongs to stays obvious. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([me, ot] as const).map((s, i) => (
          <div key={i} className="rounded-md bg-secondary/40 px-2.5 py-2">
            <div className="mb-0.5 flex items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: s.color ?? "var(--muted-foreground)" }}
              />
              <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {s.team} bench
              </span>
            </div>
            <div className="text-xs leading-relaxed text-muted-foreground">{bench(s)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchupsView() {
  const params = useSearchParams();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<MatchupSeason | null>(null);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [season, setSeason] = useState<string>("");
  const [week, setWeek] = useState<string>("");
  const [owner, setOwner] = useState<string>("");
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* The URL seeds the initial view only; afterwards the selects own it. */
  const urlWeek = useRef0(params.get("week"));
  const urlSeason = params.get("season");
  const urlOwner = params.get("owner");


  useEffect(() => {
    fetchJSON<Meta>("meta.json")
      .then((m) => {
        setMeta(m);
        setUpdated(`Updated ${relTime(m.generated_at)}`);
        const ms = m.matchup_seasons ?? [];
        setSeasons(ms);
        /* An explicit ?owner= still wins — a shared link points at one team.
           Otherwise the viewer's own pick, and only then the builder's. Read
           synchronously: this seeds the view once, and waiting on the store
           would race the meta fetch this effect already awaited. */
        setOwner(urlOwner || storedOwnerId() || m.my_owner_id);
        if (!ms.length) return;
        setSeason(urlSeason && ms.includes(urlSeason) ? urlSeason : ms[0]);
      })
      .catch(() => setError("Could not load data."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestWeekFor = useCallback((d: MatchupSeason, ownerId: string) => {
    const t = d.teams.find((x) => x.owner_id === ownerId);
    const rid = t?.roster_id ?? null;
    for (let i = d.weeks_list.length - 1; i >= 0; i--) {
      const w = d.weeks_list[i];
      if ((d.weeks[w] ?? []).some((g) => g.a.roster_id === rid || g.b.roster_id === rid)) return w;
    }
    return null;
  }, []);

  useEffect(() => {
    if (!season) return;
    setData(null);
    fetchJSON<MatchupSeason>(`matchups_${season}.json`)
      .then((d) => {
        setData(d);
        const own = d.teams.some((t) => t.owner_id === owner) ? owner : d.teams[0].owner_id;
        if (own !== owner) setOwner(own);
        const seeded = urlWeek.current && d.weeks_list.includes(urlWeek.current) ? urlWeek.current : null;
        urlWeek.current = null;
        setWeek(seeded ?? latestWeekFor(d, own) ?? d.weeks_list[d.weeks_list.length - 1]);
      })
      .catch(() => setError("Could not load season."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  if (error)
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Box Scores" title="Matchups" subtitle={error} />
      </div>
    );

  const rid = data?.teams.find((t) => t.owner_id === owner)?.roster_id ?? null;
  const games: BoxGame[] = data?.weeks[week] ?? [];
  let mine: BoxGame | null = null;
  let meSide: "a" | "b" = "a";
  for (const g of games) {
    if (g.a.roster_id === rid) {
      mine = g;
      meSide = "a";
      break;
    }
    if (g.b.roster_id === rid) {
      mine = g;
      meSide = "b";
      break;
    }
  }
  const wi = data ? data.weeks_list.indexOf(String(week)) : -1;

  const step = (d: number) => {
    if (!data) return;
    const ni = wi + d;
    if (ni < 0 || ni >= data.weeks_list.length) return;
    setWeek(data.weeks_list[ni]);
  };

  const pickTeam = (ownerId: string) => {
    setOwner(ownerId);
    if (!data) return;
    const r = data.teams.find((t) => t.owner_id === ownerId)?.roster_id ?? null;
    const plays = (data.weeks[week] ?? []).some((g) => g.a.roster_id === r || g.b.roster_id === r);
    if (!plays) {
      const w = latestWeekFor(data, ownerId);
      if (w) setWeek(w);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow="Box Scores"
        title="Matchups"
        subtitle="Browse any week of any season."
        updated={updated}
      />

      {seasons.length === 0 && meta && (
        <p className="text-sm text-muted-foreground">No matchup data yet.</p>
      )}

      {seasons.length > 0 && (
        <div className="mb-6 flex flex-wrap items-end gap-3" role="group" aria-label="Matchup filters">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Season
            </span>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="rounded-md border bg-card px-2.5 py-1.5 text-sm"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s} Season
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Week
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={wi <= 0}
                aria-label="Previous week"
                className="rounded-md border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
              >
                ‹
              </button>
              <select
                value={week}
                onChange={(e) => setWeek(e.target.value)}
                className="rounded-md border bg-card px-2.5 py-1.5 text-sm"
              >
                {(data?.weeks_list ?? []).map((w) => (
                  <option key={w} value={w}>
                    Week {w}
                    {data && Number(w) >= data.playoff_start ? " (PO)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={!data || wi >= data.weeks_list.length - 1}
                aria-label="Next week"
                className="rounded-md border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
              >
                ›
              </button>
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Team
            </span>
            <select
              value={owner}
              onChange={(e) => pickTeam(e.target.value)}
              className="rounded-md border bg-card px-2.5 py-1.5 text-sm"
            >
              {[...(data?.teams ?? [])]
                .sort((a, b) => a.team.localeCompare(b.team))
                .map((t) => (
                  <option key={t.owner_id} value={t.owner_id}>
                    {t.team}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}

      <section aria-live="polite" className="mb-10">
        {!data && seasons.length > 0 && (
          <div className="h-72 animate-pulse rounded-lg border bg-card" />
        )}
        {data && !mine && (
          <p className="text-sm text-muted-foreground">
            This team did not play a matchup this week.
          </p>
        )}
        {data && mine && (
          <BoxScore
            key={`${season}-${week}-${owner}`}
            me={mine[meSide]}
            ot={mine[meSide === "a" ? "b" : "a"]}
          />
        )}
      </section>

      {data && (
        <section>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Other Games · Week {week}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {games
              .filter((g) => g !== mine)
              .map((g, i) => {
                const aw = g.a.points > g.b.points;
                const bw = g.b.points > g.a.points;
                const row = (s: BoxSide, won: boolean) => (
                  <div
                    className={cn(
                      "flex items-center justify-between gap-3",
                      !won && "text-muted-foreground",
                    )}
                  >
                    <span className="truncate">{s.team}</span>
                    <span className={cn("font-mono tabular-nums", won && "font-bold text-ok")}>
                      {s.points.toFixed(1)}
                    </span>
                  </div>
                );
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      pickTeam(g.a.owner_id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="rounded-lg border bg-card px-4 py-3 text-left text-sm transition-colors hover:border-primary/40"
                  >
                    {row(g.a, aw)}
                    {row(g.b, bw)}
                  </button>
                );
              })}
            {games.filter((g) => g !== mine).length === 0 && (
              <p className="text-sm text-muted-foreground">No other games.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/* Tiny local ref helper so the URL-seeded week can be consumed exactly once
   without pulling useRef's generic into every call site above. */
function useRef0<T>(initial: T) {
  const [box] = useState(() => ({ current: initial }));
  return box;
}

export default function MatchupsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
          <div className="h-72 animate-pulse rounded-lg border bg-card" />
        </div>
      }
    >
      <MatchupsView />
    </Suspense>
  );
}
