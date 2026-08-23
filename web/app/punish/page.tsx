"use client";

import { useEffect, useState } from "react";
import { fetchJSON, relTime, type Meta, type Watch, type WatchTeam } from "@/lib/data";
import { PageHeader } from "@/components/gggg/primitives";
import {
  AvenuesCard, EarlyStandings, Meter, StatusBadge, TableShell, TeamCell, Th,
  pct, probLabel, record,
} from "@/components/gggg/watch";

const flag = (t: WatchTeam) => {
  if (t.status === "clinched_last") return <StatusBadge label="In the hole" tone="out" />;
  if (t.status === "safe") return <StatusBadge label="Safe" tone="in" />;
  return null;
};

export default function PunishPage() {
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
  const sims = pw && pw.n_sims > 1 ? `${pw.n_sims.toLocaleString()} times ` : "";

  const subtitle = error
    ? "Could not load punish watch data."
    : pw
      ? done
        ? `Regular season complete — ${pw.total_reg_weeks} weeks played.`
        : `Through Week ${pw.current_week} of ${pw.total_reg_weeks} regular-season weeks.`
      : "Loading…";

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-20 pt-10">
      <PageHeader eyebrow="Last Place" title="Punish Watch" subtitle={subtitle} updated={updated} />

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
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Leaderboard{" "}
            <span className="font-sans normal-case tracking-normal">
              {done ? "— final result" : "— odds of finishing dead last"}
            </span>
          </p>
          <TableShell>
            <thead>
              <tr className="border-b">
                <Th className="w-10">#</Th>
                <Th>Team</Th>
                <Th align="right">W-L</Th>
                <Th align="right">PF</Th>
                <Th align="right">Left</Th>
                <Th align="right">Proj. Wins</Th>
                <Th align="right">SOS</Th>
                <Th align="right">Bot 3</Th>
                <Th>Punish %</Th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.owner_id || t.roster_id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{t.punish_rank}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-start gap-1">
                      <TeamCell t={t} />
                      {flag(t)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{record(t)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{t.pf.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {t.games_left}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
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
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {t.sos_remaining == null ? "—" : `${(t.sos_remaining * 100).toFixed(0)}%`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {pct(t.bottom3_prob, 0)}
                  </td>
                  <td className="px-3 py-2">
                    <Meter p={t.punish_prob} tone="bad" />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          <p className="mb-3 mt-10 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Avenues{" "}
            <span className="font-sans normal-case tracking-normal">
              — where the last-place risk actually hangs
            </span>
          </p>
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
