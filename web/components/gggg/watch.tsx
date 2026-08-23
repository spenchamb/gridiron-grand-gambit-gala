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
import { MINE_ROW, TeamAvatar, YouBadge } from "@/components/gggg/primitives";
import { isMine, useMe } from "@/lib/me";
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
  const me = useMe();
  return (
    <div>
      <Link href={teamHref(t.owner_id)} className="flex items-center gap-2 hover:text-primary">
        <TeamAvatar src={t.avatar} name={t.team} />
        <span className="truncate font-bold">{t.team}</span>
        {isMine(me, t.owner_id) && <YouBadge />}
      </Link>
      <div className="pl-9 text-xs text-muted-foreground">{t.owner}</div>
    </div>
  );
}

/** Row class for a watch table — tints the viewer's own row. */
export function useMineRow() {
  const me = useMe();
  return (ownerId: string | null | undefined) => (isMine(me, ownerId) ? MINE_ROW : undefined);
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

/* Column priority.
 *
 * A ten-column leaderboard is two and a bit screens of sideways scrolling on a
 * phone, and the columns you actually came for — who, their record, their odds
 * — are the ones that scroll out of reach. Rather than making that scroll nicer,
 * the secondary columns simply do not render below their breakpoint, so the
 * table fits the screen and the full set returns on a wider one.
 *
 * `hidden` on a <td> is display:none, which takes the cell out of the row
 * entirely; the sm:table-cell puts it back. Header and body must always be
 * given the same priority or the columns misalign. */
export type Priority = "sm" | "md";

const priorityClass = (p?: Priority) =>
  p === "sm" ? "hidden sm:table-cell" : p === "md" ? "hidden md:table-cell" : "";

/** `minWidth` is the width below which the *visible* columns start to collide,
    not the table's natural width — it drops as columns are hidden. */
export function TableShell({
  children, minWidth = 480,
}: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export const Th = ({
  children, align = "left", hide, className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  hide?: Priority;
  className?: string;
}) => (
  <th
    className={cn(
      "px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:px-3 sm:py-2",
      align === "right" ? "text-right" : "text-left",
      priorityClass(hide),
      className,
    )}
  >
    {children}
  </th>
);

/** Body cell matching Th's padding and priority. */
export const Td = ({
  children, align = "left", hide, className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  hide?: Priority;
  className?: string;
}) => (
  <td
    className={cn(
      "px-2 py-1.5 sm:px-3 sm:py-2",
      align === "right" && "text-right",
      priorityClass(hide),
      className,
    )}
  >
    {children}
  </td>
);

/** Current standings, shown before the simulation has enough data to run. */
export function EarlyStandings({
  teams, note, cutAfter,
}: { teams: WatchTeam[]; note: string; cutAfter?: number }) {
  const mineRow = useMineRow();
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{note}</p>
      <TableShell minWidth={320}>
        <thead>
          <tr className="border-b">
            <Th className="w-8 sm:w-10">#</Th>
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
                mineRow(t.owner_id),
                cutAfter && i + 1 === cutAfter && "border-b-2 border-b-primary/60",
              )}
            >
              <Td className="font-mono text-muted-foreground">{i + 1}</Td>
              <Td>
                <TeamCell t={t} />
              </Td>
              <Td align="right" className="font-mono tabular-nums">{record(t)}</Td>
              <Td align="right" className="font-mono tabular-nums">{t.pf.toFixed(1)}</Td>
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
      {/* Win Prob and Swing both stand down on small screens: the pair that
          carries the argument is If Win / If Lose, and the widest swing is
          already called out by name in the last column. */}
      <table className="w-full min-w-[340px] text-sm">
        <thead>
          <tr className="border-b">
            <Th className="w-12 sm:w-16">Week</Th>
            <Th>Opponent</Th>
            <Th align="right" hide="sm">Win Prob</Th>
            <Th align="right">If Win</Th>
            <Th align="right">If Lose</Th>
            <Th align="right" hide="md">Swing</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {t.avenues.map((a, i) => {
            const sw = swing(a);
            const pivotal = sw === maxSwing && sw > 0;
            return (
              <tr key={i} className="border-b last:border-0">
                <Td className="font-mono text-muted-foreground">Wk {a.week}</Td>
                <Td>
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
                </Td>
                <Td align="right" hide="sm" className="font-mono tabular-nums text-muted-foreground">
                  {pct(a.win_prob, 0)}
                </Td>
                <Td align="right" className="font-mono tabular-nums text-ok">
                  {probLabel(ifWin(a))}
                </Td>
                <Td align="right" className="font-mono tabular-nums text-bad">
                  {probLabel(ifLose(a))}
                </Td>
                <Td align="right" hide="md" className="font-mono tabular-nums">
                  {sw > 0 ? (
                    <strong>{(sw * 100).toFixed(0)} pt</strong>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </Td>
                <Td>{pivotal && <StatusBadge label="Pivotal" tone="out" />}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
