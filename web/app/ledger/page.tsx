"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fetchJSON, relTime,
  type Ledger, type LedgerAsset, type LedgerItem, type Meta,
} from "@/lib/data";
import { PosPill, PageHeader } from "@/components/gggg/primitives";
import { legacyHref } from "@/lib/nav";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  trade: "Trades", waiver: "Waivers", free_agent: "Free Agents", commissioner: "Commish",
};
const TYPE_ORDER = ["trade", "waiver", "free_agent", "commissioner"];

const weekLabel = (w: number) => (w === 0 ? "Preseason" : `Week ${w}`);
const dayDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/* team/ is not ported yet — plain <a>. player/ is, so it gets a next/link. */
const teamHref = (id: string) => `${legacyHref("/team.html")}?owner=${encodeURIComponent(id)}`;

function TeamChip({ ownerId, color, name }: { ownerId?: string | null; color?: string | null; name: string }) {
  const inner = (
    <>
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: color ?? "var(--muted-foreground)" }}
      />
      <span className="truncate font-bold">{name}</span>
    </>
  );
  return ownerId ? (
    <a href={teamHref(ownerId)} className="flex items-center gap-2 hover:text-primary">
      {inner}
    </a>
  ) : (
    <div className="flex items-center gap-2">{inner}</div>
  );
}

function Asset({ a }: { a: LedgerAsset }) {
  if (a.kind === "faab")
    return (
      <span className="rounded-md border bg-secondary px-2 py-0.5 font-mono text-xs">
        ${a.amount} FAAB
      </span>
    );
  if (a.kind === "pick")
    return <span className="rounded-md border bg-secondary px-2 py-0.5 text-xs">{a.label}</span>;
  return (
    <Link
      href={{ pathname: "/player", query: { pid: a.pid } }}
      className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2 py-0.5 text-xs hover:border-primary/50"
    >
      {a.name}
      <PosPill pos={a.pos} />
    </Link>
  );
}

function PlayerName({ pid, name }: { pid?: string; name: string }) {
  return pid ? (
    <Link href={{ pathname: "/player", query: { pid } }} className="hover:underline">
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}

function LedgerView() {
  const params = useSearchParams();
  const [l, setL] = useState<Ledger | null>(null);
  const [updated, setUpdated] = useState("");
  const [error, setError] = useState(false);

  const [type, setType] = useState("all");
  const [season, setSeason] = useState("all");
  const [week, setWeek] = useState("all");
  const [team, setTeam] = useState("all");

  useEffect(() => {
    Promise.all([fetchJSON<Ledger>("ledger.json"), fetchJSON<Meta>("meta.json").catch(() => null)])
      .then(([ll, m]) => {
        setL(ll);
        if (m) setUpdated(`Updated ${relTime(m.generated_at)}`);

        /* Deep-linking: seed filters from the URL, ignoring any value that does
           not exist in the data so a stale or hand-typed link stays safe. */
        const t = params.get("type");
        if (t === "all" || (t && ll.type_counts?.[t])) setType(t);
        const s = params.get("season");
        if (s === "all" || (s && ll.seasons.includes(s))) setSeason(s);
        const tm = params.get("team");
        if (tm === "all" || (tm && ll.managers.some((m2) => String(m2.owner_id) === tm))) setTeam(tm);
        const w = params.get("week");
        if (w && ll.items.some((it) => String(it.week) === String(w))) setWeek(w);
      })
      .catch(() => setError(true));
    // params is read once on load by design — later changes come from the UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Reflect filter state back into the URL so any view is shareable. */
  useEffect(() => {
    if (!l) return;
    const p = new URLSearchParams();
    if (type !== "all") p.set("type", type);
    if (season !== "all") p.set("season", season);
    if (week !== "all") p.set("week", week);
    if (team !== "all") p.set("team", team);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
  }, [l, type, season, week, team]);

  const weeks = useMemo(() => {
    if (!l) return [];
    return [...new Set(l.items.filter((it) => season === "all" || it.season === season).map((it) => it.week))]
      .sort((a, b) => b - a);
  }, [l, season]);

  /* A week that does not exist in the new season selection falls back to all. */
  useEffect(() => {
    if (week !== "all" && !weeks.map(String).includes(String(week))) setWeek("all");
  }, [weeks, week]);

  const items = useMemo(() => {
    if (!l) return [];
    return l.items.filter((it) => {
      if (type !== "all" && it.type !== type) return false;
      if (season !== "all" && it.season !== season) return false;
      if (week !== "all" && String(it.week) !== String(week)) return false;
      if (team !== "all" && !(it.owner_ids ?? []).includes(team)) return false;
      return true;
    });
  }, [l, type, season, week, team]);

  if (error)
    return (
      <main className="mx-auto w-full max-w-4xl px-6 pb-20 pt-10">
        <PageHeader eyebrow="League Activity" title="Ledger" subtitle="Could not load transaction data." />
      </main>
    );

  if (!l)
    return (
      <main className="mx-auto w-full max-w-4xl px-6 pb-20 pt-10">
        <PageHeader eyebrow="League Activity" title="Ledger" subtitle="Loading…" />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </main>
    );

  const deadline = season !== "all" ? l.deadlines?.[season] : undefined;
  const types = TYPE_ORDER.filter((t) => l.type_counts?.[t]);

  /* Group by (season, week); items arrive newest-first so groups stay ordered. */
  const rendered: React.ReactNode[] = [];
  let curKey: string | null = null;
  const divided = new Set<string>();
  for (const it of items) {
    const key = `${it.season}|${it.week}`;
    if (key !== curKey) {
      const d = l.deadlines?.[it.season];
      if (d && !divided.has(it.season) && it.week <= d) {
        rendered.push(
          <div key={`dl-${it.season}`} className="my-4 rounded-md border border-dashed px-3 py-1.5 text-center font-mono text-xs text-muted-foreground">
            🔒 Trade Deadline · Week {d}
          </div>,
        );
        divided.add(it.season);
      }
      rendered.push(
        <div key={`h-${key}`} className="mb-2 mt-6 flex items-baseline justify-between border-b pb-1 font-mono text-xs uppercase tracking-wider">
          <span className="font-bold">{weekLabel(it.week)}</span>
          <span className="text-muted-foreground">{it.season}</span>
        </div>,
      );
      curKey = key;
    }
    rendered.push(it.type === "trade" ? <Trade key={it.id} it={it} /> : <Move key={it.id} it={it} />);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-20 pt-10">
      <PageHeader
        eyebrow="League Activity"
        title="Ledger"
        subtitle={`${(l.count ?? 0).toLocaleString()} transactions · ${l.seasons.length} season${
          l.seasons.length === 1 ? "" : "s"
        }`}
        updated={updated}
      />

      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={type === "all"} onClick={() => setType("all")} label="All" n={l.count} />
          {types.map((t) => (
            <Chip
              key={t}
              active={type === t}
              onClick={() => setType(t)}
              label={TYPE_LABEL[t] ?? t}
              n={l.type_counts[t]}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={season} onChange={setSeason} aria-label="Season">
            <option value="all">All seasons</option>
            {l.seasons.map((s) => (
              <option key={s} value={s}>
                {s} season
              </option>
            ))}
          </Select>
          <Select value={week} onChange={setWeek} aria-label="Week">
            <option value="all">All weeks</option>
            {weeks.map((w) => (
              <option key={w} value={String(w)}>
                {weekLabel(w)}
              </option>
            ))}
          </Select>
          <Select value={team} onChange={setTeam} aria-label="Team">
            <option value="all">All teams</option>
            {l.managers.map((m) => (
              <option key={m.owner_id} value={m.owner_id}>
                {m.team}
              </option>
            ))}
          </Select>
        </div>
        {deadline && (
          <div className="rounded-md border border-l-4 border-l-warn bg-card px-3 py-2 text-xs text-muted-foreground">
            🔒 {season} trade deadline — Week {deadline}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No transactions match these filters.
        </div>
      ) : (
        <div>{rendered}</div>
      )}
    </main>
  );
}

function Chip({ active, onClick, label, n }: { active: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
    >
      {label}
      <span className={cn("font-mono text-[10px]", active ? "opacity-70" : "text-muted-foreground")}>
        {n.toLocaleString()}
      </span>
    </button>
  );
}

function Select({
  value, onChange, children, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
} & React.AriaAttributes) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
    </select>
  );
}

function Trade({ it }: { it: LedgerItem }) {
  return (
    <div className="mb-2 rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span>⇄ Trade</span>
        <span>{dayDate(it.ts)}</span>
      </div>
      {(it.sides ?? []).map((sd, i) => (
        <div key={i} className="border-b px-3 py-2 last:border-0">
          <TeamChip ownerId={sd.owner_id} color={sd.color} name={sd.team} />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sd.gets?.length ? (
              sd.gets.map((a, j) => <Asset key={j} a={a} />)
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Move({ it }: { it: LedgerItem }) {
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-l-4 bg-card px-3 py-2 text-sm"
      style={{ borderLeftColor: it.color ?? "var(--border)" }}
    >
      <TeamChip ownerId={it.owner_id} color={it.color} name={it.team ?? "—"} />
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {it.add && it.add.kind === "player" && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-ok">
              + <PlayerName pid={it.add.pid} name={it.add.name} />
            </span>
            <PosPill pos={it.add.pos} />
          </span>
        )}
        {it.drop && it.drop.kind === "player" && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-bad">
              − <PlayerName pid={it.drop.pid} name={it.drop.name} />
            </span>
            <PosPill pos={it.drop.pos} />
          </span>
        )}
        {!it.add && !it.drop && <span className="text-muted-foreground">—</span>}
      </div>
      <span className="font-mono text-xs text-muted-foreground">{dayDate(it.ts)}</span>
      {it.bid != null && (
        <span className="rounded-sm bg-secondary px-1.5 py-px font-mono text-xs">${it.bid}</span>
      )}
    </div>
  );
}

export default function LedgerPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-4xl px-6 pb-20 pt-10">
          <div className="h-64 animate-pulse rounded-lg border bg-card" />
        </main>
      }
    >
      <LedgerView />
    </Suspense>
  );
}
