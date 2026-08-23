"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJSON, relTime, type Keepers, type KeeperCell, type Meta } from "@/lib/data";
import { Headshot, PosPill, TeamAvatar, PageHeader, Note } from "@/components/gggg/primitives";
import { cn } from "@/lib/utils";

const ord = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

function Cell({ c }: { c: KeeperCell | null }) {
  if (!c) return <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-center text-muted-foreground">—</td>;
  return (
    <td className={cn("px-2 py-1.5 align-top sm:px-3 sm:py-2", c.final && "bg-warn/10")}>
      <Link
        href={{ pathname: "/player", query: { pid: c.pid } }}
        className="flex items-center gap-2 hover:text-primary"
      >
        <Headshot pid={c.pid} pos={c.pos} nflTeam={c.nfl_team} />
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold">{c.name}</span>
          <span className="mt-0.5 flex items-center gap-1">
            <PosPill pos={c.pos} />
            <span className="text-[10px] text-muted-foreground">{c.nfl_team ?? ""}</span>
          </span>
        </span>
      </Link>
      <span
        className={cn(
          "mt-1 inline-block rounded-sm px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide",
          c.final ? "bg-warn text-background" : "bg-secondary text-muted-foreground",
        )}
      >
        {c.final
          ? `${ord(c.roster_year)} yr · kept ${c.kept}× · final`
          : `${ord(c.roster_year)} yr${c.kept ? ` · kept ${c.kept}×` : ""}`}
      </span>
    </td>
  );
}

export default function KeepersPage() {
  const [k, setK] = useState<Keepers | null>(null);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchJSON<Keepers>("keepers.json"),
      fetchJSON<Meta>("meta.json").catch(() => null),
    ])
      .then(([kk, m]) => {
        setK(kk);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
      })
      .catch(() => setError(true));
  }, []);

  const seasons = k?.seasons ?? [];
  const latest = k?.latest_season;
  const finals =
    k && latest
      ? k.teams.map((t) => ({ t, c: t.keepers[latest] })).filter((x) => x.c?.final)
      : [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow="League History"
        title="Keepers"
        subtitle={
          error
            ? "Could not load keeper data."
            : k
              ? `${seasons.length} seasons · ${seasons[0]}–${seasons[seasons.length - 1]}`
              : "Every team's kept player, season by season."
        }
        updated={updated}
      />

      <Note>
        Each team protects one <strong className="text-foreground">keeper</strong> per season. A
        player can be kept at most <strong className="text-foreground">twice</strong> — three seasons
        on a roster — before he must be released back to the draft. The tag under each name shows his{" "}
        <strong className="text-foreground">roster tenure</strong> (year 1–3) and how many times he
        has been kept; a player in his <span className="font-bold text-warn">3rd season (kept twice)</span>{" "}
        is in his final keeper year and must be released next season.
      </Note>

      {finals.length > 0 && latest && (
        <Note tone="warn">
          <strong className="text-foreground">Final keeper year in {latest}:</strong>{" "}
          {finals.map((x, i) => (
            <span key={x.t.owner_id}>
              {i > 0 && " · "}
              <span className="text-foreground">{x.c!.name}</span> ({x.t.team})
            </span>
          ))}{" "}
          — each must be released to the draft next season.
        </Note>
      )}

      {k && k.teams.length > 0 ? (
        /* The one table here that cannot shed columns to fit a phone: it is a
           team × season matrix and gains a column every year, so sideways
           scrolling is the format rather than a failure of it. What breaks on a
           phone is losing track of whose row you are reading, so the team
           column pins to the left edge instead. */
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 w-32 border-r bg-card px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:w-auto sm:px-3 sm:py-2">
                  Team
                </th>
                {seasons.map((s) => (
                  <th
                    key={s}
                    className="px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:px-3 sm:py-2"
                  >
                    {s}
                    {s === latest && <span className="ml-1 text-ok">•</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {k.teams.map((t) => (
                <tr key={t.owner_id} className="border-b last:border-0">
                  <td className="sticky left-0 z-10 w-32 border-r bg-card px-2 py-1.5 sm:w-auto sm:px-3 sm:py-2">
                    <Link
                      href={{ pathname: "/team", query: { owner: t.owner_id } }}
                      className="flex items-center gap-2 hover:text-primary"
                    >
                      <TeamAvatar src={t.avatar} name={t.team} className="size-6 sm:size-7" />
                      <span className="truncate text-xs font-bold sm:text-sm">{t.team}</span>
                    </Link>
                  </td>
                  {seasons.map((s) => (
                    <Cell key={s} c={t.keepers[s] ?? null} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && <div className="h-64 animate-pulse rounded-lg border bg-card" />
      )}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>
          <span className="rounded-sm bg-secondary px-1.5 py-px font-mono text-[9px] font-bold uppercase">
            2nd yr · kept 1×
          </span>{" "}
          = roster tenure &amp; times kept
        </span>
        <span>
          <span className="rounded-sm bg-warn px-1.5 py-px font-mono text-[9px] font-bold uppercase text-background">
            3rd yr · kept 2× · final
          </span>{" "}
          last season eligible
        </span>
        <span>
          Highlighted column <span className="text-ok">•</span> is the current season.
        </span>
      </div>
    </div>
  );
}
