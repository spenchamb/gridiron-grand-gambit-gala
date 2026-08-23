"use client";

/* Shared pieces for the two "watch" pages.
 *
 * playoff.html and punish.html are the same page with different metrics: same
 * three states (no teams / not ready / simulated), same team cell, same meter,
 * same avenues table. Only the column set and the direction of "good" differ.
 * The identical parts live here; the two routes stay thin and keep their own
 * column definitions rather than being forced through one over-general prop. */

import Link from "next/link";
import type { Avenue, WatchTeam } from "@/lib/data";
import { TeamAvatar } from "@/components/gggg/primitives";
import { cn } from "@/lib/utils";

export const pct = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : `${(v * 100).toFixed(d)}%`;

/** Vanilla rule: show <0.1% rather than a misleading 0.0%. */
export const probLabel = (p: number | null | undefined) => {
  if (p == null) return "—";
  if (p >= 0.001 || p === 0) return pct(p, p >= 0.1 ? 0 : 1);
  return "<0.1%";
};

export const record = (t: WatchTeam) =>
  `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;

export const teamHref = (ownerId?: string | null) => ({
  pathname: "/team",
  query: { owner: ownerId ?? "" },
});

export function TeamCell({ t }: { t: WatchTeam }) {
  return (
    <div>
      <Link href={teamHref(t.owner_id)} className="flex items-center gap-2 hover:text-primary">
        <TeamAvatar src={t.avatar} name={t.team} />
        <span className="truncate font-bold">{t.team}</span>
      </Link>
      <div className="pl-9 text-xs text-muted-foreground">{t.owner}</div>
    </div>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: "in" | "out" | "hunt" }) {
  return (
    <span
      className={cn(
        "ml-1 inline-block shrink-0 rounded-sm px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide",
        tone === "in" && "bg-ok text-background",
        tone === "out" && "bg-bad text-background",
        tone === "hunt" && "bg-secondary text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

/** Inline probability bar. `tone` flips which direction reads as good. */
export function Meter({ p, tone = "good" }: { p: number | null | undefined; tone?: "good" | "bad" }) {
  const w = Math.max(2, Math.round((p ?? 0) * 100));
  return (
    <div className="relative h-5 w-full min-w-[92px] overflow-hidden rounded-sm bg-secondary">
      <span
        className={cn("absolute inset-y-0 left-0", tone === "good" ? "bg-ok/70" : "bg-bad/70")}
        style={{ width: `${w}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold">
        {probLabel(p)}
      </span>
    </div>
  );
}

export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[820px] text-sm">{children}</table>
    </div>
  );
}

export const Th = ({
  children, align = "left", className,
}: { children?: React.ReactNode; align?: "left" | "right"; className?: string }) => (
  <th
    className={cn(
      "px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground",
      align === "right" ? "text-right" : "text-left",
      className,
    )}
  >
    {children}
  </th>
);

/** Current standings, shown before the simulation has enough data to run. */
export function EarlyStandings({
  teams, note, cutAfter,
}: { teams: WatchTeam[]; note: string; cutAfter?: number }) {
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{note}</p>
      <TableShell>
        <thead>
          <tr className="border-b">
            <Th className="w-10">#</Th>
            <Th>Team</Th>
            <Th align="right">W-L</Th>
            <Th align="right">PF</Th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t, i) => (
            <tr
              key={t.owner_id || t.roster_id}
              className={cn(
                "border-b last:border-0",
                cutAfter && i + 1 === cutAfter && "border-b-2 border-b-primary/60",
              )}
            >
              <td className="px-3 py-2 font-mono text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-2">
                <TeamCell t={t} />
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{record(t)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{t.pf.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}

/** Per-team remaining schedule with win/lose leverage. */
export function AvenuesCard({
  t, subtitle, ifWin, ifLose, swing,
}: {
  t: WatchTeam;
  subtitle: React.ReactNode;
  ifWin: (a: Avenue) => number | null | undefined;
  ifLose: (a: Avenue) => number | null | undefined;
  swing: (a: Avenue) => number;
}) {
  const maxSwing = Math.max(...t.avenues.map(swing));
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border bg-card">
      <div className="px-3 pb-2 pt-3 font-mono text-xs font-bold uppercase tracking-[0.1em] text-primary">
        <Link href={teamHref(t.owner_id)} className="hover:underline">
          {t.team}
        </Link>
        <span className="font-sans font-normal normal-case tracking-normal text-muted-foreground">
          {" · "}
          {subtitle}
        </span>
      </div>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b">
            <Th className="w-16">Week</Th>
            <Th>Opponent</Th>
            <Th align="right">Win Prob</Th>
            <Th align="right">If Win</Th>
            <Th align="right">If Lose</Th>
            <Th align="right">Swing</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {t.avenues.map((a, i) => {
            const sw = swing(a);
            const pivotal = sw === maxSwing && sw > 0;
            return (
              <tr key={i} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono text-muted-foreground">Wk {a.week}</td>
                <td className="px-3 py-2">
                  <Link
                    href={teamHref(a.opp_owner_id)}
                    className="flex items-center gap-2 hover:text-primary"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: a.opp_color ?? "var(--muted-foreground)" }}
                    />
                    <span className="truncate font-bold">{a.opp_team}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {pct(a.win_prob, 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ok">
                  {probLabel(ifWin(a))}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-bad">
                  {probLabel(ifLose(a))}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {sw > 0 ? (
                    <strong>{(sw * 100).toFixed(0)} pt</strong>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {pivotal && <StatusBadge label="Pivotal" tone="out" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
