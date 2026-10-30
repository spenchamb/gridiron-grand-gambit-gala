"use client";

import { useEffect, useState } from "react";
import { fetchJSON, relTime, type Meta, type Watch, type WatchTeam } from "@/lib/data";
import { PageHeader } from "@/components/gggg/primitives";
import { SectionLabel } from "@/components/gggg/league-sections";
import {
  AvenuesCard, EarlyStandings, Meter, StatusBadge, TableShell, Td, TeamCell, Th,
  pct, probLabel, record, useMineRow,
} from "@/components/gggg/watch";
import { cn } from "@/lib/utils";

const flag = (t: WatchTeam) => {
  if (t.status === "clinched_last") return <StatusBadge label="In the hole" tone="out" />;
  return null;
};

export default function PunishPage() {
  const mineRow = useMineRow();
  const [pw, setPw] = useState<Watch | null>(null);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchJSON<Watch>("punish_watch.json"),
      fetchJSON<Meta>("meta.json").catch(() => null),
    ])
      .then(([p, m]) => {
        setPw(p);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
      })
      .catch(() => setError(true));
  }, []);

  const teams = pw?.teams ?? [];
  const done = teams.length > 0 && teams.every((t) => t.games_left === 0);
  /* A team that can no longer finish last is not part of the race. They are
     named in one line under the table instead of wearing a pill each. */
  const atRisk = teams.filter((t) => t.status !== "safe");
  const safe = teams.filter((t) => t.status === "safe");
  const lead = teams.find((t) => t.punish_rank === 1) ?? teams[0];
  const sims = pw && pw.n_sims > 1 ? `${pw.n_sims.toLocaleString()} times ` : "";

  const subtitle = error
    ? "Could not load punish watch data."
    : pw
      ? done
        ? `Regular season complete — ${pw.total_reg_weeks} weeks played.`
        : `Through Week ${pw.current_week} of ${pw.total_reg_weeks} regular-season weeks.`
      : "Loading…";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader title="Punish Watch" subtitle={subtitle} updated={updated} />

      {pw && pw.ready && !done && lead && (
        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-brand text-5xl leading-none text-punish sm:text-6xl">{pct(lead.punish_prob, 0)}</span>
          <span className="text-sm text-muted-foreground">
            <strong className="font-bold text-foreground">{lead.team}</strong>: chance of finishing dead last
          </span>
        </div>
      )}

      {pw && teams.length > 0 && (
        <p className="mb-8 text-sm text-muted-foreground">
          Whoever finishes dead last takes the punishment. Each remaining schedule is simulated{" "}
          {sims}to estimate the odds below.
        </p>
      )}

      {pw && teams.length === 0 && <p className="text-sm text-muted-foreground">No standings yet.</p>}

      {pw && teams.length > 0 && !pw.ready && (
        <EarlyStandings
          teams={[...teams]
            .sort((a, b) => a.wins - b.wins || a.pf - b.pf)
            .slice(0, Math.min(5, teams.length))}
          note={`Full simulation activates after Week 7 (currently Week ${pw.current_week}) — the current cellar.`}
        />
      )}

      {pw && teams.length > 0 && pw.ready && (
        <>
          <SectionLabel sub={done ? "Final result" : "Odds of finishing dead last"}>Leaderboard</SectionLabel>
          {/* Same priority split as Playoff Watch: who, record, projection,
              odds on a phone; the supporting columns return at md. */}
          <TableShell minWidth={340}>
            <thead>
              <tr className="border-b">
                <Th className="w-8 sm:w-10">#</Th>
                <Th>Team</Th>
                <Th align="right" className="whitespace-nowrap">W-L</Th>
                <Th align="right" hide="md">PF</Th>
                <Th align="right" hide="md">Left</Th>
                <Th align="right" hide="sm">Proj. Wins</Th>
                <Th align="right" hide="md">SOS</Th>
                <Th align="right" hide="md">Bot 3</Th>
                <Th>Punish %</Th>
              </tr>
            </thead>
            <tbody>
              {atRisk.map((t) => (
                <tr key={t.owner_id || t.roster_id} className={cn("border-b last:border-0", mineRow(t.owner_id))}>
                  <Td className="font-mono text-muted-foreground">{t.punish_rank}</Td>
                  <Td className="max-w-[46vw] sm:max-w-none">
                    {/* Column capped on phones so the odds meter stays on screen;
                        the badge wraps under the name rather than widening it. */}
                    <div className="flex min-w-0 flex-wrap items-start gap-1">
                      <TeamCell t={t} />
                      {flag(t)}
                    </div>
                  </Td>
                  <Td align="right" className="whitespace-nowrap font-mono tabular-nums">{record(t)}</Td>
                  <Td align="right" hide="md" className="font-mono tabular-nums">
                    {t.pf.toFixed(1)}
                  </Td>
                  <Td align="right" hide="md" className="font-mono tabular-nums text-muted-foreground">
                    {t.games_left}
                  </Td>
                  <Td align="right" hide="sm" className="font-mono tabular-nums">
                    {t.games_left === 0 ? (
                      t.wins
                    ) : (
                      <>
                        {t.proj_wins_median}
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          {t.proj_wins_low}–{t.proj_wins_high}
                        </span>
                      </>
                    )}
                  </Td>
                  <Td align="right" hide="md" className="font-mono tabular-nums text-muted-foreground">
                    {t.sos_remaining == null ? "—" : `${(t.sos_remaining * 100).toFixed(0)}%`}
                  </Td>
                  <Td align="right" hide="md" className="font-mono tabular-nums text-muted-foreground">
                    {pct(t.bottom3_prob, 0)}
                  </Td>
                  <Td>
                    <Meter p={t.punish_prob} tone="bad" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          {safe.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Can no longer finish last: {safe.map((t) => t.team).join(", ")}.
            </p>
          )}

          <div className="mt-10">
            <SectionLabel sub="Where the last-place risk actually hangs">Avenues</SectionLabel>
          </div>
          {(() => {
            const live = teams
              .filter((t) => t.games_left > 0 && (t.punish_prob ?? 0) >= 0.005)
              .slice(0, 6);
            if (!live.length)
              return (
                <p className="text-sm text-muted-foreground">
                  {done
                    ? "Regular season complete — the punishment seat is locked in."
                    : "No live punishment contenders — the field has separated."}
                </p>
              );
            return live.map((t) => (
              <AvenuesCard
                key={t.owner_id || t.roster_id}
                t={t}
                subtitle={`${record(t)} · ${probLabel(t.punish_prob)} to finish last`}
                ifWin={(a) => a.punish_if_win}
                ifLose={(a) => a.punish_if_lose}
                /* Leverage runs the other way here: losing raises the risk. */
                swing={(a) =>
                  a.punish_if_lose != null && a.punish_if_win != null
                    ? a.punish_if_lose - a.punish_if_win
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
