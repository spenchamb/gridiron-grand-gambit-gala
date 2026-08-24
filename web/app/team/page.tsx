"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fetchJSON, relTime,
  type EcrFull, type Meta, type TeamFile, type TeamRosterPlayer, type TeamSeason,
} from "@/lib/data";
import { Headshot, PlayerLink, PosPill, StatCard, PageHeader } from "@/components/gggg/primitives";
import { storedOwnerId, useMe } from "@/lib/me";
import { cn } from "@/lib/utils";

const ord = (n: number) => ["", "st", "nd", "rd"][n] ?? "th";
const slotLabel = (s: string) =>
  ({ WRRB_FLEX: "W/R", REC_FLEX: "W/T", SUPER_FLEX: "SFLX" })[s] ?? s;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Darken a #rrggbb by a factor, for the accent's dimmed companion. */
function shade(hex: string | null | undefined, f: number) {
  if (!hex || hex[0] !== "#") return hex ?? undefined;
  const n = parseInt(hex.slice(1), 16);
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) =>
    Math.round(x * f)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
}

const FLEX_ELIG: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};
const slotEligible = (slot: string, pos: string) =>
  FLEX_ELIG[slot] ? FLEX_ELIG[slot].includes(pos) : slot === pos;

/** Greedy optimal starters by a value function; fixed slots before flex. */
function optimalStarters(
  roster: TeamRosterPlayer[],
  slots: string[],
  valueOf: (p: TeamRosterPlayer) => number | null,
) {
  const pool = roster
    .filter((p) => p.pid != null)
    .map((p) => ({ pid: String(p.pid), pos: p.pos, v: valueOf(p) }))
    .filter((p): p is { pid: string; pos: string; v: number } => p.v != null)
    .sort((a, b) => b.v - a.v);
  const used = new Set<string>();
  const started = new Set<string>();
  const order = [...slots].sort((a, b) => (FLEX_ELIG[a] ? 1 : 0) - (FLEX_ELIG[b] ? 1 : 0));
  for (const slot of order) {
    const pick = pool.find((p) => !used.has(p.pid) && slotEligible(slot, p.pos));
    if (pick) {
      used.add(pick.pid);
      started.add(pick.pid);
    }
  }
  return started;
}

function Collapsible({
  label, defaultOpen = false, children,
}: { label: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.13em] text-muted-foreground hover:text-foreground"
      >
        <span>{label}</span>
        <span className={cn("transition-transform", open && "rotate-90")}>▶</span>
      </button>
      {open && <div className="pt-1">{children}</div>}
    </div>
  );
}

function TeamView() {
  const params = useSearchParams();
  const [team, setTeam] = useState<TeamFile | null>(null);
  const [ecr, setEcr] = useState<EcrFull | null>(null);
  const [updated, setUpdated] = useState("");
  const [missing, setMissing] = useState(false);

  const me = useMe();

  useEffect(() => {
    (async () => {
      let m: Meta | null = null;
      try {
        m = await fetchJSON<Meta>("meta.json");
      } catch {}
      if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
      fetchJSON<EcrFull>("ecr.json").then(setEcr).catch(() => setEcr(null));
      /* Bare /team is "my team" — an explicit ?owner= still wins so shared
         links keep pointing where they were aimed. */
      const owner = params.get("owner") || storedOwnerId() || m?.my_owner_id;
      if (!owner) return setMissing(true);
      try {
        setTeam(await fetchJSON<TeamFile>(`team_${owner}.json`));
      } catch {
        setMissing(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("owner"), me.ownerId]);

  useEffect(() => {
    if (team) document.title = `${team.meta.team} · GGGG`;
  }, [team]);

  const ecrOf = useMemo(
    () => (pid: string | null) => (pid && ecr?.players?.[String(pid)]) || null,
    [ecr],
  );

  if (missing)
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader
          eyebrow="Team"
          title="Team not found"
          subtitle="Pick a team from the sidebar."
          updated={updated}
        />
      </div>
    );

  if (!team)
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Team" title="Loading…" updated={updated} />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );

  const at = team.all_time;
  const s0 = team.seasons[0];
  const eff = s0?.efficiency;
  const color = team.meta.color;

  /* The vanilla page set --accent on documentElement. Under client-side routing
     that would leak into every page navigated to afterwards, so the override is
     scoped to this subtree instead — same effect, no bleed. */
  const themeVars = color
    ? ({ ["--primary"]: color, ["--ring"]: shade(color, 0.7) } as React.CSSProperties)
    : undefined;

  return (
    <div style={themeVars} className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <div className="mb-2 flex items-center gap-5">
        {team.meta.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={team.meta.avatar}
            alt=""
            className="size-20 shrink-0 rounded-full border bg-secondary object-cover"
          />
        ) : (
          <span className="flex size-20 shrink-0 items-center justify-center rounded-full border bg-secondary text-lg font-bold text-muted-foreground">
            {team.meta.team.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {team.meta.owner} · {at.seasons} season{at.seasons > 1 ? "s" : ""}
          </div>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">{team.meta.team}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {at.w}-{at.l}
            {at.t ? `-${at.t}` : ""} all-time · {(at.win_pct * 100).toFixed(0)}%
            {at.championships > 0 && (
              <span className="text-warn">
                {" · "}
                {"🏆".repeat(at.championships)} {at.championships} title
                {at.championships > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
      </div>
      <p className="mb-8 h-4 font-mono text-xs text-muted-foreground">{updated}</p>

      <section className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="All-Time Record"
          value={`${at.w}-${at.l}${at.t ? `-${at.t}` : ""}`}
          sub={`${(at.win_pct * 100).toFixed(1)}% · ${at.seasons} seasons`}
        />
        <StatCard
          label="Championships"
          value={String(at.championships)}
          sub={`${at.playoff_apps} playoff appearance${at.playoff_apps !== 1 ? "s" : ""}`}
        />
        <StatCard
          label="Best Finish"
          value={`${at.best_finish}${ord(at.best_finish)}`}
          sub={`total ${at.pf.toFixed(0)} PF`}
        />
        {eff && eff.pct != null ? (
          <StatCard
            label="Lineup IQ"
            value={`${eff.pct}%`}
            sub={`${eff.left_on_bench} pts left on bench (${s0.season})`}
          />
        ) : (
          <StatCard
            label="Best Game"
            value={at.high ? at.high.pts.toFixed(1) : "—"}
            sub={at.high ? `${at.high.season} Wk ${at.high.week}` : ""}
          />
        )}
      </section>

      {s0?.recommended && (
        <section className="mb-10">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Recommended Lineup{" "}
            <span className="font-sans normal-case tracking-normal">
              — based on {s0.recommended.basis}
            </span>
          </p>
          <div className="overflow-hidden rounded-lg border bg-card">
            {s0.recommended.lineup.map((r, i) => {
              const e = ecrOf(r.pid);
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0"
                >
                  <span
                    className={cn(
                      "w-11 shrink-0 rounded-sm px-1 py-px text-center font-mono text-[9px] font-bold uppercase",
                      r.player ? "bg-secondary text-primary" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {slotLabel(r.slot)}
                  </span>
                  {r.player ? (
                    <>
                      <Headshot pid={r.pid ?? ""} pos={r.pos} nflTeam={r.nfl_team} />
                      <span className="min-w-0 flex-1 truncate">
                        <PlayerLink pid={r.pid}>{r.player}</PlayerLink>{" "}
                        <span className="text-xs text-muted-foreground">
                          {r.pos}·{r.nfl_team}
                          {e?.pos_rank ? ` · Consensus ${e.pos_rank}` : ""}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">{(r.ppg ?? 0).toFixed(1)}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-muted-foreground">— empty —</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-sm">
            <span className="text-muted-foreground">Projected weekly total (PPG basis)</span>
            <strong className="font-mono">{s0.recommended.proj_total.toFixed(1)}</strong>
          </div>
          <StartSit season={s0} ecrOf={ecrOf} mode={ecr?.mode} />
        </section>
      )}

      <RosOutlook season={s0} ecr={ecr} ecrOf={ecrOf} />

      <section>
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Season by Season
        </p>
        {team.seasons.map((s, i) => (
          <SeasonBlock key={s.season} s={s} defaultOpen={i === 0} />
        ))}
      </section>
    </div>
  );
}

function StartSit({
  season, ecrOf, mode,
}: {
  season: TeamSeason;
  ecrOf: (pid: string | null) => { ecr?: number | null; pos_rank?: string } | null;
  mode?: string;
}) {
  const rec = season.recommended;
  const roster = season.roster ?? [];
  if (!rec?.lineup || !roster.length) return null;
  const modeLabel = mode === "ros" ? "rest-of-season" : "preseason";

  const slots = rec.lineup.map((r) => r.slot);
  const ppgStart = new Set(rec.lineup.filter((r) => r.pid != null).map((r) => String(r.pid)));
  /* Lower ECR is better, so negate. Unranked players cannot make the ECR lineup. */
  const ecrStart = optimalStarters(roster, slots, (p) => {
    const e = ecrOf(p.pid);
    return e?.ecr != null ? -e.ecr : null;
  });
  const nameOf = (pid: string) =>
    roster.find((x) => String(x.pid) === String(pid))?.player ?? pid;
  const rankOf = (pid: string) => ecrOf(pid)?.pos_rank ?? "—";

  const promote = [...ecrStart].filter((pid) => !ppgStart.has(pid));
  const demote = [...ppgStart].filter((pid) => !ecrStart.has(pid));

  if (!promote.length)
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        ✓ The {modeLabel} consensus agrees with the recommended lineup.
      </p>
    );

  return (
    <div className="mt-3 rounded-lg border bg-card px-4 py-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.13em] text-primary">
        ⚑ Consensus disagrees with the projection
      </div>
      <ul className="mt-1.5 list-disc pl-5 text-sm leading-relaxed">
        {promote.map((pid, i) => {
          const out = demote[i];
          return (
            <li key={pid}>
              <span className="text-ok">Start {nameOf(pid)}</span>{" "}
              <span className="text-muted-foreground">(Consensus {rankOf(pid)})</span>
              {out && (
                <>
                  {" over "}
                  <span className="text-bad">{nameOf(out)}</span>{" "}
                  <span className="text-muted-foreground">(Consensus {rankOf(out)})</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">
        The {modeLabel} consensus would set a different lineup than the PPG projection.
      </p>
    </div>
  );
}

function RosOutlook({
  season, ecr, ecrOf,
}: {
  season?: TeamSeason;
  ecr: EcrFull | null;
  ecrOf: (pid: string | null) => { ecr?: number | null; pos_rank?: string; owned?: number | null } | null;
}) {
  const roster = season?.roster ?? [];
  if (!ecr?.players || !roster.length) return null;
  const modeLabel = ecr.mode === "ros" ? "rest-of-season" : "preseason";

  const ranked = roster
    .filter((p) => p.pid != null)
    .map((p) => {
      const e = ecrOf(p.pid);
      return { p, e, ecr: e?.ecr != null ? e.ecr : Infinity };
    })
    .sort((a, b) => a.ecr - b.ecr);
  if (!ranked.some((r) => isFinite(r.ecr))) return null;

  const byPts = [...roster.filter((p) => p.pid != null)].sort(
    (a, b) => (b.pts_ppr ?? 0) - (a.pts_ppr ?? 0),
  );
  const ptsRank: Record<string, number> = {};
  byPts.forEach((p, i) => (ptsRank[String(p.pid)] = i + 1));
  const ecrList = ranked.filter((r) => isFinite(r.ecr));
  const ecrRank: Record<string, number> = {};
  ecrList.forEach((r, i) => (ecrRank[String(r.p.pid)] = i + 1));
  const n = ecrList.length;
  const threshold = Math.max(3, Math.round(n * 0.25));

  return (
    <section className="mb-10">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
        Roster Outlook{" "}
        <span className="font-sans normal-case tracking-normal">
          — {modeLabel} consensus (PPR)
        </span>
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[440px] text-sm">
          <thead>
            <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-left">Player</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">ECR</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Pos</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">Ros%</th>
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">PPR</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ p, e, ecr: rank }) => {
              /* Only tag skill-flex positions — QB/K/DEF rank structurally low
                 in overall ECR in a 1-QB league, so the points-vs-ECR contrast
                 is biased for them. */
              let tag: React.ReactNode = null;
              if (isFinite(rank) && (p.pts_ppr ?? 0) > 0 && ["RB", "WR", "TE"].includes(p.pos)) {
                const pr = ptsRank[String(p.pid)];
                const er = ecrRank[String(p.pid)];
                if (er - pr >= threshold)
                  tag = (
                    <span className="ml-1 rounded-sm bg-bad px-1 font-mono text-[9px] font-bold uppercase text-background">
                      sell-high
                    </span>
                  );
                else if (pr - er >= threshold)
                  tag = (
                    <span className="ml-1 rounded-sm bg-ok px-1 font-mono text-[9px] font-bold uppercase text-background">
                      buy-low
                    </span>
                  );
              }
              return (
                <tr key={String(p.pid)} className="border-b last:border-0">
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    <div className="flex items-center gap-2">
                      <Headshot pid={String(p.pid)} pos={p.pos} nflTeam={p.nfl_team} />
                      <div className="min-w-0">
                        <div className="truncate font-bold">
                          <PlayerLink pid={p.pid}>{p.player}</PlayerLink>
                          {tag}
                        </div>
                        {p.nick && p.nick !== p.player && (
                          <div className="truncate text-[11px] italic text-muted-foreground">
                            &ldquo;{p.nick}&rdquo;
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {p.pos} · {p.nfl_team}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono font-bold tabular-nums">
                    {isFinite(rank) ? rank : <span className="text-muted-foreground">unranked</span>}
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {e?.pos_rank ?? ""}
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {e?.owned != null ? `${Math.round(e.owned)}%` : ""}
                  </td>
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {(p.pts_ppr ?? 0).toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SeasonBlock({ s, defaultOpen }: { s: TeamSeason; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const eff = s.efficiency;
  return (
    <div className="mb-3 overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-accent/40"
      >
        <span className="font-mono text-base font-bold">
          {s.season}
          {s.champion ? " 🏆" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {s.team_name} · {s.record} ·{" "}
          {s.finish ? `${s.finish}${ord(s.finish)} place` : ""} · {s.pf.toFixed(0)} PF
        </span>
        <span className={cn("text-muted-foreground transition-transform", open && "rotate-90")}>
          ▶
        </span>
      </button>

      {open && (
        <div className="border-t px-4 py-3">
          {eff && eff.pct != null && (
            <div className="mb-4">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.13em] text-muted-foreground">
                Lineup Efficiency
              </div>
              <div className="h-2.5 overflow-hidden rounded-sm bg-secondary">
                <div className="h-full bg-primary" style={{ width: `${eff.pct}%` }} />
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {eff.pct}% efficient · {eff.actual} of {eff.optimal} optimal pts
                </span>
                <span>{eff.left_on_bench} left on bench</span>
              </div>
            </div>
          )}

          <Collapsible label="Roster" defaultOpen>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-14 px-2 py-1.5 text-left">Slot</th>
                    <th className="px-2 py-1.5 text-left">Player</th>
                    <th className="px-2 py-1.5 text-right">Season PPR</th>
                  </tr>
                </thead>
                <tbody>
                  {s.roster.map((p, i) => {
                    const starter = p.slot && p.slot !== "BN";
                    return (
                      <tr key={`${p.pid}-${i}`} className="border-b last:border-0">
                        <td className="px-2 py-1.5">
                          <span
                            className={cn(
                              "inline-block rounded-sm px-1 py-px font-mono text-[9px] font-bold uppercase",
                              starter
                                ? "bg-secondary text-primary"
                                : "bg-secondary text-muted-foreground",
                            )}
                          >
                            {slotLabel(p.slot ?? "BN")}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <Headshot pid={String(p.pid)} pos={p.pos} nflTeam={p.nfl_team} />
                            <div className="min-w-0">
                              <div className="truncate font-bold">
                                <PlayerLink pid={p.pid}>{p.player}</PlayerLink>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {p.pos} · {p.nfl_team}
                                {p.age != null ? ` · ${p.age}y` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {(p.pts_ppr ?? 0).toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Collapsible>

          <Collapsible label="Game Log">
            {s.game_log?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[330px] text-sm">
                  <thead>
                    <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="w-12 px-2 py-1.5 text-left">Wk</th>
                      <th className="px-2 py-1.5 text-left">Opponent</th>
                      <th className="px-2 py-1.5 text-right">Score</th>
                      <th className="px-2 py-1.5 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.game_log.map((g, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">{g.week}</td>
                        <td className="px-2 py-1.5">{g.opp}</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {g.pts.toFixed(1)} – {g.opp_pts.toFixed(1)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right font-bold",
                            g.result === "W" && "text-ok",
                            g.result === "L" && "text-bad",
                            g.result === "T" && "text-warn",
                          )}
                        >
                          {g.result}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No games.</p>
            )}
          </Collapsible>

          {s.draft_picks && s.draft_picks.length > 0 && (
            <Collapsible label="Draft Picks">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-2 py-1.5 text-left">Rd</th>
                      <th className="px-2 py-1.5 text-left">Pick</th>
                      <th className="px-2 py-1.5 text-left">Player</th>
                      <th className="px-2 py-1.5 text-left">Pos</th>
                      <th className="px-2 py-1.5 text-right">PPR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.draft_picks.map((p, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-2 py-1.5 text-muted-foreground">{p.round}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{p.pick}</td>
                        <td className="px-2 py-1.5 font-bold">
                          <PlayerLink pid={p.pid}>{p.player}</PlayerLink>
                        </td>
                        <td className="px-2 py-1.5">
                          <PosPill pos={p.pos} />
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {(p.pts_ppr ?? 0).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Collapsible>
          )}

          {s.transactions && s.transactions.length > 0 && (
            <Collapsible label={`Transactions (${s.transactions.length})`}>
              <div className="rounded-md border">
                {s.transactions.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 border-b px-3 py-2 last:border-0">
                    <span className="mt-0.5 rounded-sm bg-secondary px-1.5 py-px font-mono text-[9px] font-bold uppercase text-muted-foreground">
                      {t.type === "free_agent" ? "FA" : t.type}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      {t.type === "trade" ? (
                        <div>
                          <strong>Trade</strong> — {t.summary}
                        </div>
                      ) : (
                        <div>
                          <span className="text-ok">+ {t.add}</span>{" "}
                          <span className="text-muted-foreground">({t.add_pos})</span>
                          {t.drop && <span className="text-bad"> − {t.drop}</span>}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">{fmtDate(t.created)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeamPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
          <div className="h-64 animate-pulse rounded-lg border bg-card" />
        </div>
      }
    >
      <TeamView />
    </Suspense>
  );
}
