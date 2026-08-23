"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchJSON, relTime,
  type EcrFull, type Meta, type TradeData, type TradePlayer, type TradeTeam,
} from "@/lib/data";
import {
  makeEcrLookup, makeStartVal, makeTradeVal, optimal, posCounts, slotLabel,
} from "@/lib/trade";
import { Headshot, PageHeader, Note } from "@/components/gggg/primitives";
import { cn } from "@/lib/utils";

const Delta = ({ n }: { n: number }) => (
  <span className={cn("font-mono font-bold", n > 0 ? "text-ok" : n < 0 ? "text-bad" : "text-muted-foreground")}>
    {n > 0 ? "+" : ""}
    {n.toFixed(1)}
  </span>
);

export default function TradePage() {
  const [data, setData] = useState<TradeData | null>(null);
  const [ecr, setEcr] = useState<EcrFull | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);

  const [aId, setAId] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);
  const [sendA, setSendA] = useState<Set<string>>(new Set());
  const [sendB, setSendB] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([fetchJSON<TradeData>("trade.json"), fetchJSON<Meta>("meta.json").catch(() => null)])
      .then(([d, m]) => {
        setData(d);
        setMeta(m);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);
        /* Default A to the user's own team, B to the first other. */
        const mine = m ? d.teams.find((t) => t.owner_id === m.my_owner_id) : null;
        const a = mine ?? d.teams[0];
        const b = d.teams.find((t) => t.roster_id !== a.roster_id) ?? d.teams[1];
        setAId(a.roster_id);
        setBId(b.roster_id);
      })
      .catch(() => setError(true));
    fetchJSON<EcrFull>("ecr.json").then(setEcr).catch(() => setEcr(null));
  }, []);

  const startVal = useMemo(() => makeStartVal(data?.use_projections ?? true), [data]);
  const tradeVal = useMemo(() => makeTradeVal(makeEcrLookup(ecr)), [ecr]);
  const posRankOf = useCallback(
    (p: TradePlayer) => makeEcrLookup(ecr)(p.pid)?.pos_rank ?? "",
    [ecr],
  );

  const team = (id: number | null) => data?.teams.find((t) => t.roster_id === id) ?? null;
  const A = team(aId);
  const B = team(bId);

  const bestLineup = useCallback(
    (players: TradePlayer[]) =>
      data ? optimal(players, data.slots, data.flex_map, startVal) : null,
    [data, startVal],
  );

  const clear = () => {
    setSendA(new Set());
    setSendB(new Set());
  };

  const toggle = (side: "a" | "b", pid: string) => {
    const [set, setter] = side === "a" ? [sendA, setSendA] : [sendB, setSendB];
    const next = new Set(set as Set<string>);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    (setter as (s: Set<string>) => void)(next);
  };

  const swap = () => {
    setAId(bId);
    setBId(aId);
    const a = sendA;
    setSendA(sendB);
    setSendB(a);
  };

  if (error)
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Trade Lab" title="Trade What-If" subtitle="Could not load trade data." />
      </div>
    );

  if (!data || !A || !B)
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
        <PageHeader eyebrow="Trade Lab" title="Trade What-If" subtitle="Loading…" />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );

  const startBasis = data.use_projections
    ? `Week ${data.proj_week} projected points`
    : "last-season points/game";

  const inA = B.players.filter((p) => sendB.has(p.pid)); // A receives what B sends
  const inB = A.players.filter((p) => sendA.has(p.pid));
  const aAfter = A.players.filter((p) => !sendA.has(p.pid)).concat(inA);
  const bAfter = B.players.filter((p) => !sendB.has(p.pid)).concat(inB);

  const optAb = bestLineup(A.players)!.total;
  const optAa = bestLineup(aAfter)!.total;
  const optBb = bestLineup(B.players)!.total;
  const optBa = bestLineup(bAfter)!.total;

  const valA = inA.reduce((s, p) => s + tradeVal(p), 0);
  const valB = inB.reduce((s, p) => s + tradeVal(p), 0);
  const totV = valA + valB || 1;
  const pctA = Math.round((valA / totV) * 100);
  const balance = 100 - Math.abs(pctA - 50) * 2;
  const diff = valA - valB;
  const adiff = Math.abs(diff);
  const favTeam = diff > 0 ? A : B;
  const empty = sendA.size === 0 && sendB.size === 0;

  const Roster = ({ t, side, set }: { t: TradeTeam; side: "a" | "b"; set: Set<string> }) => (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-bold">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
        {t.team}
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">tap to trade</span>
      </div>
      {t.players.map((p) => {
        const sending = set.has(p.pid);
        const pr = posRankOf(p);
        const sv = startVal(p);
        return (
          <button
            key={p.pid}
            type="button"
            aria-pressed={sending}
            onClick={() => toggle(side, p.pid)}
            className={cn(
              "flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-0 transition-colors",
              sending ? "bg-primary/15" : "hover:bg-accent/50",
            )}
          >
            <Headshot pid={p.pid} pos={p.pos} nflTeam={p.nfl_team} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{p.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {pr || p.pos}
                {sv ? ` · ${sv.toFixed(1)} pts` : ""}
              </span>
            </span>
            {p.starter && (
              <span className="rounded-sm bg-secondary px-1 font-mono text-[9px] font-bold text-muted-foreground">
                ST
              </span>
            )}
            {sending && (
              <span className="rounded-sm bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground">
                OUT
              </span>
            )}
            <span className="w-9 shrink-0 text-right font-mono text-xs" title="Consensus value">
              {tradeVal(p).toFixed(1)}
            </span>
          </button>
        );
      })}
    </div>
  );

  const Impact = ({
    t, out, inc, before, after, poolAfter, valOut, valIn,
  }: {
    t: TradeTeam; out: TradePlayer[]; inc: TradePlayer[];
    before: number; after: number; poolAfter: TradePlayer[];
    valOut: number; valIn: number;
  }) => {
    const pre = posCounts(t.players);
    const post = posCounts(poolAfter);
    const opt = bestLineup(poolAfter)!;
    const warn = !opt.full
      ? "⚠ Can't fill every starting slot after this trade."
      : (post.RB ?? 0) < 2
        ? `⚠ Thin at RB (${post.RB ?? 0}).`
        : (post.WR ?? 0) < 2
          ? `⚠ Thin at WR (${post.WR ?? 0}).`
          : null;
    return (
      <div className="rounded-lg border bg-card px-4 py-3">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: t.color }}>
          {t.team}
        </div>
        <div className="my-1.5 text-xs text-muted-foreground">
          Gives {out.length} · Gets {inc.length}
        </div>
        {ecr && (
          <div className="mb-1.5 text-sm">
            Consensus value <Delta n={valIn - valOut} />{" "}
            <span className="text-xs text-muted-foreground">
              (+{valIn.toFixed(1)} / −{valOut.toFixed(1)})
            </span>
          </div>
        )}
        <div className="mb-2 text-sm">
          Best lineup {before.toFixed(1)} → <strong>{after.toFixed(1)}</strong>{" "}
          <Delta n={after - before} />
        </div>
        <div className="text-xs text-muted-foreground">
          {["QB", "RB", "WR", "TE", "K", "DEF"]
            .filter((pp) => (pre[pp] ?? 0) || (post[pp] ?? 0))
            .map((pp) => {
              const d = (post[pp] ?? 0) - (pre[pp] ?? 0);
              return (
                <span key={pp}>
                  {pp} {post[pp] ?? 0}
                  {d !== 0 && (
                    <span className={d > 0 ? "text-ok" : "text-bad"}>
                      {" "}
                      ({d > 0 ? "+" : ""}
                      {d})
                    </span>
                  )}
                  {" · "}
                </span>
              );
            })}
        </div>
        {warn && <div className="mt-2 text-xs text-warn">{warn}</div>}
      </div>
    );
  };

  const ResultLineup = ({ t, pool }: { t: TradeTeam; pool: TradePlayer[] }) => {
    const opt = bestLineup(pool)!;
    const bench = pool
      .filter((p) => !opt.picks.includes(p))
      .sort((x, y) => startVal(y) - startVal(x));
    return (
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-bold">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
          {t.team}
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          {data.slots.map((slot, i) => {
            const p = opt.picks[i];
            return (
              <div key={i} className="flex items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0">
                <span className="w-11 shrink-0 rounded-sm bg-secondary px-1 py-px text-center font-mono text-[9px] font-bold uppercase text-primary">
                  {slotLabel(slot)}
                </span>
                {p ? (
                  <>
                    <Headshot pid={p.pid} pos={p.pos} nflTeam={p.nfl_team} />
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {p.pos}·{p.nfl_team}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums">{startVal(p).toFixed(1)}</span>
                  </>
                ) : (
                  <span className="flex-1 text-muted-foreground">— empty —</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-muted-foreground">Projected total</span>
          <strong className="font-mono">{opt.total.toFixed(1)}</strong>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          <strong className="text-foreground">Bench:</strong>{" "}
          {bench.map((p) => p.name).join(" · ") || "—"}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        eyebrow="Trade Lab"
        title="Trade What-If"
        subtitle="Draft a hypothetical trade and see how both rosters change."
        updated={updated}
      />

      <div className="mb-8 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Team A
          </span>
          <select
            value={aId ?? ""}
            onChange={(e) => {
              const id = +e.target.value;
              setAId(id);
              if (id === bId) setBId(data.teams.find((t) => t.roster_id !== id)!.roster_id);
              clear();
            }}
            className="rounded-md border bg-card px-2.5 py-1.5 text-sm"
          >
            {data.teams.map((t) => (
              <option key={t.roster_id} value={t.roster_id}>
                {t.team}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={swap}
          aria-label="Swap the two teams"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          ⇄
        </button>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Team B
          </span>
          <select
            value={bId ?? ""}
            onChange={(e) => {
              const id = +e.target.value;
              setBId(id);
              if (id === aId) setAId(data.teams.find((t) => t.roster_id !== id)!.roster_id);
              clear();
            }}
            className="rounded-md border bg-card px-2.5 py-1.5 text-sm"
          >
            {data.teams.map((t) => (
              <option key={t.roster_id} value={t.roster_id}>
                {t.team}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={clear}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Clear trade
        </button>
      </div>

      <section aria-live="polite" className="mb-8 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {A.team} sends
          </div>
          <Chips players={inB} onRemove={(pid) => toggle("a", pid)} />
        </div>
        <div className="text-center text-2xl text-muted-foreground">⇄</div>
        <div className="sm:text-right">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {B.team} sends
          </div>
          <Chips players={inA} onRemove={(pid) => toggle("b", pid)} align="right" />
        </div>
      </section>

      <section className="mb-10">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Rosters{" "}
          <span className="font-sans normal-case tracking-normal">
            — tap a player to add or remove them from the trade
          </span>
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Roster t={A} side="a" set={sendA} />
          <Roster t={B} side="b" set={sendB} />
        </div>
      </section>

      <section aria-live="polite" className="mb-10">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Trade Analysis{" "}
          <span className="font-sans normal-case tracking-normal">
            {ecr
              ? `— fairness by consensus value; lineup impact by ${startBasis}`
              : `— value basis: ${startBasis}`}
          </span>
        </p>

        {empty ? (
          <Note>
            Tap players on each side to draft a trade. You&apos;ll get a{" "}
            <strong className="text-foreground">consensus value</strong> fairness read (a
            cross-position market curve from expert rankings) plus each team&apos;s{" "}
            <strong className="text-foreground">win-now lineup</strong> change and roster balance.
          </Note>
        ) : (
          <>
            <div className="mb-4 rounded-lg border bg-card px-4 py-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Consensus value balance
              </div>
              <div className="flex h-3 overflow-hidden rounded-sm">
                <div style={{ width: `${pctA}%`, background: A.color }} />
                <div style={{ width: `${100 - pctA}%`, background: B.color }} />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {A.team} gets {valA.toFixed(1)} ({pctA}%)
                </span>
                <span>{balance}% even</span>
                <span>
                  {B.team} gets {valB.toFixed(1)} ({100 - pctA}%)
                </span>
              </div>
              <p className="mt-3 text-sm">
                {!ecr ? (
                  "Consensus value unavailable — showing lineup impact only."
                ) : adiff < 3 ? (
                  <>
                    <strong>Even by consensus value</strong> — within {adiff.toFixed(1)} pts.
                  </>
                ) : (
                  <>
                    Consensus value favors{" "}
                    <strong style={{ color: favTeam.color }}>{favTeam.team}</strong> by{" "}
                    {adiff.toFixed(1)} pts ({Math.max(pctA, 100 - pctA)}% /{" "}
                    {Math.min(pctA, 100 - pctA)}%).
                  </>
                )}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Win-now starting lineup: {A.team} <Delta n={optAa - optAb} />, {B.team}{" "}
                <Delta n={optBa - optBb} /> projected pts/wk.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Impact t={A} out={inB} inc={inA} before={optAb} after={optAa} poolAfter={aAfter} valOut={valB} valIn={valA} />
              <Impact t={B} out={inA} inc={inB} before={optBb} after={optBa} poolAfter={bAfter} valOut={valA} valIn={valB} />
            </div>
          </>
        )}
      </section>

      {!empty && (
        <section>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Resulting Starting Lineups{" "}
            <span className="font-sans normal-case tracking-normal">
              — best legal lineup after the trade
            </span>
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            <ResultLineup t={A} pool={aAfter} />
            <ResultLineup t={B} pool={bAfter} />
          </div>
        </section>
      )}
    </div>
  );
}

function Chips({
  players, onRemove, align = "left",
}: { players: TradePlayer[]; onRemove: (pid: string) => void; align?: "left" | "right" }) {
  if (!players.length)
    return <div className="text-sm text-muted-foreground">No players yet</div>;
  return (
    <div className={cn("flex flex-wrap gap-1.5", align === "right" && "sm:justify-end")}>
      {players.map((p) => (
        <button
          key={p.pid}
          type="button"
          onClick={() => onRemove(p.pid)}
          className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2 py-0.5 text-xs hover:border-bad/60"
        >
          {p.name}
          <span className="text-muted-foreground">✕</span>
        </button>
      ))}
    </div>
  );
}
