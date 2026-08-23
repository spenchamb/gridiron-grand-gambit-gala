"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchJSON, relTime, type Meta, type Player, type StatLine } from "@/lib/data";
import { COLS, cellValue } from "@/lib/playerCols";
import { PosPill, StatCard, PageHeader } from "@/components/gggg/primitives";
import { cn } from "@/lib/utils";

const PLACEHOLDER_HIDE = { visibility: "hidden" as const };

function PlayerView() {
  /* useSearchParams must sit inside a Suspense boundary: with output:"export"
     there is no server render, so Next prerenders the shell and fills the query
     in on the client. Without the boundary the build fails outright. */
  const params = useSearchParams();
  const pid = params.get("pid");

  const [p, setP] = useState<Player | null>(null);
  const [updated, setUpdated] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJSON<Meta>("meta.json")
      .then((m) => setUpdated(`Updated ${relTime(m.generated_at)}`))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pid) return;
    setP(null);
    setNotFound(false);
    fetchJSON<Player>(`players/${pid}.json`)
      .then(setP)
      .catch(() => setNotFound(true));
  }, [pid]);

  useEffect(() => {
    if (p) document.title = `${p.name} · GGGG`;
  }, [p]);

  if (!pid) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Player" title="No player selected" updated={updated} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow="Player"
          title="Player not found"
          subtitle="No league game log on record for this player."
          updated={updated}
        />
      </div>
    );
  }

  if (!p) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Player" title="Loading…" updated={updated} />
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  const s = p.summary;
  const headSrc =
    p.pos === "DEF" && p.nfl_team
      ? `https://sleepercdn.com/images/team_logos/nfl/${p.nfl_team.toLowerCase()}.png`
      : `https://sleepercdn.com/content/nfl/players/thumb/${p.pid}.jpg`;

  const bySeason = new Map<string, typeof p.log>();
  p.log.forEach((g) => {
    const arr = bySeason.get(g.season) ?? [];
    arr.push(g);
    bySeason.set(g.season, arr);
  });
  const seasons = [...bySeason.keys()].sort().reverse();
  const cols = COLS[p.pos] ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <div className="mb-2 flex items-center gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={headSrc}
          alt=""
          onError={(e) => Object.assign(e.currentTarget.style, PLACEHOLDER_HIDE)}
          className="size-20 shrink-0 rounded-full border bg-secondary object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <PosPill pos={p.pos} />
            <span>{p.nfl_team ?? "FA"}</span>
            {p.age ? <span>· age {p.age}</span> : null}
          </div>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">{p.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {s.started} start{s.started !== 1 ? "s" : ""} / {s.games} rostered week
            {s.games !== 1 ? "s" : ""}
            {s.teams?.length ? ` · ${s.teams.join(", ")}` : ""}
          </p>
        </div>
      </div>
      <p className="mb-8 h-4 font-mono text-xs text-muted-foreground">{updated}</p>

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Started Points"
          value={s.started_pts.toFixed(1)}
          sub={`${s.ppg_started.toFixed(1)} PPG when started`}
        />
        <StatCard
          label="Games Started"
          value={String(s.started)}
          sub={`of ${s.games} rostered · ${s.games ? Math.round((s.started / s.games) * 100) : 0}%`}
        />
        <StatCard
          label="Best Game"
          value={s.best ? s.best.pts.toFixed(1) : "—"}
          sub={s.best ? `${s.best.season} Wk ${s.best.week} · ${s.best.team}` : ""}
        />
        <StatCard label="Seasons" value={String(s.seasons.length)} sub={s.seasons.join(", ")} />
      </section>

      {p.nicknames && p.nicknames.length > 0 && (
        <section className="mb-8">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Nicknames{" "}
            <span className="font-sans normal-case tracking-normal">
              — given by managers over the years
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {p.nicknames.map((n, i) => (
              <span
                key={i}
                className="inline-flex items-baseline gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm"
              >
                <b className="italic">&ldquo;{n.nick}&rdquo;</b>
                {n.team && <span className="text-[11px] text-muted-foreground">{n.team}</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
        Game Log{" "}
        <span className="font-sans normal-case tracking-normal">
          — every recorded week in the league
        </span>
      </p>

      {seasons.length === 0 && <p className="text-sm text-muted-foreground">No game log.</p>}

      {seasons.map((season) => {
        const rows = [...bySeason.get(season)!].sort((a, b) => b.week - a.week);
        const started = rows.filter((r) => r.started);
        const startedPts = started.reduce((t, r) => t + r.pts, 0);
        const totPts = rows.reduce((t, r) => t + r.pts, 0);
        const tot: StatLine = {};
        rows.forEach((r) =>
          Object.entries(r.st ?? {}).forEach(([k, v]) => {
            tot[k] = (tot[k] ?? 0) + (v ?? 0);
          }),
        );
        const bye = p.byes?.[season];

        return (
          <div key={season} className="mb-4 overflow-x-auto rounded-lg border bg-card">
            <div className="px-3 pb-2 pt-3 font-mono text-xs font-bold uppercase tracking-[0.1em] text-primary">
              {season}{" "}
              <span className="font-sans font-normal normal-case tracking-normal text-muted-foreground">
                · {started.length} starts · {startedPts.toFixed(1)} pts
                {bye ? <span className="text-warn"> · Bye Wk {bye}</span> : null}
              </span>
            </div>
            <table className="w-full min-w-[460px] text-sm">
              <thead>
                <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-12 px-2 py-1.5 sm:w-14 sm:px-3 sm:py-2 text-left">Wk</th>
                  <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">FF Team</th>
                  <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Role</th>
                  <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Pts</th>
                  {cols.map(([h]) => (
                    <th key={h} className="px-2 py-1.5 text-right sm:px-3 sm:py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = r.st ?? {};
                  return (
                    <tr key={`${r.season}-${r.week}-${i}`} className="border-b last:border-0">
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">
                        {r.week}
                        {r.playoff && <span className="text-[10px]"> PO</span>}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                        {r.team && r.owner_id ? (
                          <Link
                            className="font-bold hover:text-primary"
                            href={{
                              pathname: "/matchups",
                              query: { season: r.season, week: r.week, owner: r.owner_id },
                            }}
                          >
                            {r.team}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{r.team ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                        {r.started ? (
                          <span className="font-mono text-[11px] font-bold text-ok">START</span>
                        ) : (
                          <span className="text-muted-foreground">bench</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono font-bold tabular-nums sm:px-3 sm:py-2",
                          !r.started && "text-muted-foreground",
                        )}
                      >
                        {r.pts.toFixed(1)}
                      </td>
                      {cols.map(([h, get]) => {
                        const v = cellValue(get(st));
                        return (
                          <td
                            key={h}
                            className={cn(
                              "px-2 py-1.5 text-right font-mono tabular-nums sm:px-3 sm:py-2",
                              !r.started && "text-muted-foreground",
                            )}
                          >
                            {v ?? <span className="text-muted-foreground">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="border-t-2">
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-muted-foreground">Σ</td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs text-muted-foreground">season total</td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right text-muted-foreground">
                    {started.length} gs
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono font-bold tabular-nums">
                    {totPts.toFixed(1)}
                  </td>
                  {cols.map(([h, get]) => {
                    const v = cellValue(get(tot));
                    return (
                      <td
                        key={h}
                        className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground sm:px-3 sm:py-2"
                      >
                        {v ?? "·"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>
          <b className="text-foreground">Start</b> = in the starting lineup that week · bench =
          rostered but not started
        </span>
        <span>PO = playoff week · Team = who rostered them that week</span>
      </div>
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
          <div className="h-40 animate-pulse rounded-lg border bg-card" />
        </div>
      }
    >
      <PlayerView />
    </Suspense>
  );
}
