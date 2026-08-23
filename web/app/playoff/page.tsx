"use client";

import { useEffect, useState } from "react";
import { fetchJSON, relTime, type Meta, type Watch, type WatchTeam } from "@/lib/data";
import { PageHeader } from "@/components/gggg/primitives";
import {
  AvenuesCard, EarlyStandings, Meter, StatusBadge, TableShell, Td, TeamCell, Th,
  pct, probLabel, record,
} from "@/components/gggg/watch";

const flag = (t: WatchTeam, done: boolean) => {
  if (t.status === "clinched") return <StatusBadge label={done ? "In" : "Clinched"} tone="in" />;
  if (t.status === "eliminated")
    return <StatusBadge label={done ? "Out" : "Eliminated"} tone="out" />;
  return <StatusBadge label="In the hunt" tone="hunt" />;
};

export default function PlayoffPage() {
  const [po, setPo] = useState<Watch | null>(null);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchJSON<Watch>("playoff_watch.json"),
      fetchJSON<Meta>("meta.json").catch(() => null),
    ])
      .then(([p, m]) => {
        setPo(p);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
      })
      .catch(() => setError(true));
  }, []);

  const teams = po?.teams ?? [];
  const done = teams.length > 0 && teams.every((t) => t.games_left === 0);
  const hasByes = (po?.byes ?? 0) > 0;
  const sims = po && po.n_sims > 1 ? `${po.n_sims.toLocaleString()} times ` : "";

  const subtitle = error
    ? "Could not load playoff watch data."
    : po
      ? done
        ? `Regular season complete — ${po.total_reg_weeks} weeks played.`
        : `Through Week ${po.current_week} of ${po.total_reg_weeks} regular-season weeks.`
      : "Loading…";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow="Postseason"
        title="Playoff Watch"
        subtitle={subtitle}
        updated={updated}
      />

      {po && teams.length > 0 && (
        <p className="mb-8 text-sm text-muted-foreground">
          The field is the top {po.playoff_teams}.{" "}
          {hasByes &&
            `The top ${po.byes} seeds earn a first-round bye — a higher bar than just making it. `}
          Each remaining schedule is simulated {sims}to estimate the odds below.
        </p>
      )}

      {po && teams.length === 0 && <p className="text-sm text-muted-foreground">No standings yet.</p>}

      {po && teams.length > 0 && !po.ready && (
        <EarlyStandings
          teams={[...teams].sort((a, b) => b.wins - a.wins || b.pf - a.pf)}
          cutAfter={po.playoff_teams}
          note={`Full simulation activates after Week 4 (currently Week ${po.current_week}) — current standings with the playoff line.`}
        />
      )}

      {po && teams.length > 0 && po.ready && (
        <>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Leaderboard{" "}
            <span className="font-sans normal-case tracking-normal">
              {done ? "— final result" : "— odds of making the field"}
            </span>
          </p>
          {/* A phone shows the four columns the page exists to answer — who,
              their record, where they project, and the odds. Games left, SOS,
              bye and top-seed odds are all supporting detail and wait for a
              wider screen rather than pushing the odds off the edge. */}
          <TableShell minWidth={340}>
            <thead>
              <tr className="border-b">
                <Th className="w-8 sm:w-10">#</Th>
                <Th>Team</Th>
                <Th align="right">W-L</Th>
                <Th align="right" hide="md">PF</Th>
                <Th align="right" hide="md">Left</Th>
                <Th align="right" hide="sm">Proj. Seed</Th>
                <Th align="right" hide="md">SOS</Th>
                {hasByes && <Th align="right" hide="md">Bye</Th>}
                <Th align="right" hide="md">#1</Th>
                <Th>Playoff %</Th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.owner_id || t.roster_id} className="border-b last:border-0">
                  <Td className="font-mono text-muted-foreground">{t.playoff_rank}</Td>
                  <Td>
                    <div className="flex items-start gap-1">
                      <TeamCell t={t} />
                      {flag(t, done)}
                    </div>
                  </Td>
                  <Td align="right" className="font-mono tabular-nums">{record(t)}</Td>
                  <Td align="right" hide="md" className="font-mono tabular-nums">
                    {t.pf.toFixed(1)}
                  </Td>
                  <Td align="right" hide="md" className="font-mono tabular-nums text-muted-foreground">
                    {t.games_left}
                  </Td>
                  <Td align="right" hide="sm" className="font-mono tabular-nums">
                    {t.proj_seed_median}
                    {t.games_left > 0 && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {t.proj_seed_best}–{t.proj_seed_worst}
                      </span>
                    )}
                  </Td>
                  <Td align="right" hide="md" className="font-mono tabular-nums text-muted-foreground">
                    {t.sos_remaining == null ? "—" : `${(t.sos_remaining * 100).toFixed(0)}%`}
                  </Td>
                  {hasByes && (
                    <Td align="right" hide="md" className="font-mono tabular-nums text-muted-foreground">
                      {pct(t.bye_prob, 0)}
                    </Td>
                  )}
                  <Td align="right" hide="md" className="font-mono tabular-nums text-muted-foreground">
                    {pct(t.top_seed_prob, 0)}
                  </Td>
                  <Td>
                    <Meter p={t.playoff_prob} tone="good" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          <p className="mb-3 mt-10 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Avenues{" "}
            <span className="font-sans normal-case tracking-normal">
              — what each bubble team&apos;s remaining games are worth
            </span>
          </p>
          {(() => {
            const live = teams
              .filter((t) => t.status === "hunt" && t.games_left > 0)
              .sort(
                (a, b) =>
                  Math.abs((a.playoff_prob ?? 0) - 0.5) - Math.abs((b.playoff_prob ?? 0) - 0.5),
              )
              .slice(0, 6);
            if (!live.length)
              return (
                <p className="text-sm text-muted-foreground">
                  {done
                    ? "Regular season complete — the playoff field is set."
                    : "No teams on the bubble — the field has separated."}
                </p>
              );
            return live.map((t) => (
              <AvenuesCard
                key={t.owner_id || t.roster_id}
                t={t}
                subtitle={`${record(t)} · ${probLabel(t.playoff_prob)} to make the playoffs`}
                ifWin={(a) => a.playoff_if_win}
                ifLose={(a) => a.playoff_if_lose}
                swing={(a) =>
                  a.playoff_if_win != null && a.playoff_if_lose != null
                    ? a.playoff_if_win - a.playoff_if_lose
                    : -1
                }
              />
            ));
          })()}
        </>
      )}
    </div>
  );
}
