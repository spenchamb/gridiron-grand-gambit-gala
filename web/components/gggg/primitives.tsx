/* Shared display primitives.
 *
 * These exist in nearly every remaining vanilla page as inline innerHTML in
 * app.js (headshotHTML, posPill, avatarHTML) or as repeated markup (stat cards).
 * Extracting them on the third port rather than the twelfth. */

import { cn } from "@/lib/utils";

const PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2a1e16"/></svg>',
  );

/** Position pill. Colours match www/assets/style.css (.pos-QB … .pos-DEF). */
const POS_CLASS: Record<string, string> = {
  QB: "bg-bad text-background",
  RB: "bg-ok text-background",
  WR: "bg-primary text-primary-foreground",
  TE: "bg-warn text-background",
  K: "bg-info text-background",
  DEF: "bg-muted-foreground text-background",
};

export function PosPill({ pos, className }: { pos: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-1.5 py-px font-mono text-[10px] font-bold tracking-wide",
        POS_CLASS[pos] ?? "bg-secondary text-muted-foreground",
        className,
      )}
    >
      {pos}
    </span>
  );
}

/** Player headshot. Team defences use the club logo — there is no person. */
export function Headshot({
  pid, pos, nflTeam, className,
}: { pid: string; pos?: string; nflTeam?: string | null; className?: string }) {
  const isDef = pos === "DEF" && nflTeam;
  const src = isDef
    ? `https://sleepercdn.com/images/team_logos/nfl/${String(nflTeam).toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget;
        img.onerror = null;
        img.src = PLACEHOLDER;
      }}
      className={cn(
        "size-7 shrink-0 rounded-full bg-secondary",
        isDef ? "object-contain p-0.5" : "object-cover",
        className,
      )}
    />
  );
}

/** Manager avatar, initials when Sleeper has no image on file. */
export function TeamAvatar({
  src, name, className,
}: { src?: string | null; name: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn("size-7 shrink-0 rounded-full border bg-secondary object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border bg-secondary text-[10px] font-bold text-muted-foreground",
        className,
      )}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Label / value / sub tile. `accent` mirrors the vanilla .record-card. */
export function StatCard({
  label, value, sub, accent = false,
}: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40">
      <div
        className={cn(
          "font-mono text-[10px] font-bold uppercase tracking-[0.13em]",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div className="mt-1.5 font-mono text-xl font-bold leading-tight">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Page header block — eyebrow / title / subtitle, used by every route. */
export function PageHeader({
  eyebrow, title, subtitle, updated,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  updated?: string;
}) {
  return (
    <>
      <header className="mb-2">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {eyebrow}
        </div>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      <p className="mb-8 h-4 font-mono text-xs text-muted-foreground">{updated}</p>
    </>
  );
}

/** Callout box — vanilla .wi-note. */
export function Note({
  children, tone = "default",
}: { children: React.ReactNode; tone?: "default" | "warn" }) {
  return (
    <div
      className={cn(
        "mb-6 rounded-lg border border-l-4 bg-card px-4 py-3 text-sm text-muted-foreground",
        tone === "warn" ? "border-l-warn" : "border-l-primary",
      )}
    >
      {children}
    </div>
  );
}
