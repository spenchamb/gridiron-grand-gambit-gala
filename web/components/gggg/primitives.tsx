/* Shared display primitives.
 *
 * These exist in nearly every remaining vanilla page as inline innerHTML in
 * app.js (headshotHTML, posPill, avatarHTML) or as repeated markup (stat cards).
 * Extracting them on the third port rather than the twelfth. */

import { cn } from "@/lib/utils";

/* Transparent, not a filled square: the <img> already carries bg-secondary, so
   letting it show through keeps the fallback on-theme instead of baking a dark
   brown into a data URI that a light page cannot override. */
const PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>');

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

/* The three blocks below all tighten below `sm`. A phone gives up roughly a
   third of its width to the same padding that reads as generous on a desktop,
   and these are the shapes the pages repeat most, so the saving compounds. */

/** Label / value / sub tile. `accent` mirrors the vanilla .record-card. */
export function StatCard({
  label, value, sub, accent = false,
}: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/40 sm:px-4 sm:py-3">
      <div
        className={cn(
          "font-mono text-[10px] font-bold uppercase tracking-[0.13em]",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-bold leading-tight sm:mt-1.5 sm:text-xl">
        {value}
      </div>
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
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs sm:tracking-[0.2em]">
          {eyebrow}
        </div>
        {/* 36px is three wrapped lines for a title like "The Gridiron Grand
            Gambit Gala" at 375px, and the eyebrow already says where you are. */}
        <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-4xl sm:leading-none">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 text-sm text-muted-foreground sm:mt-2">{subtitle}</p>
        ) : null}
      </header>
      {/* Fixed height even when empty: `updated` arrives with the data, and
          reserving the line keeps the page from jumping when it lands. */}
      <p className="mb-5 h-4 font-mono text-[11px] text-muted-foreground sm:mb-8 sm:text-xs">
        {updated}
      </p>
    </>
  );
}

/* Marking the viewer's own team.
 *
 * One treatment, used by every list that shows all twelve managers, so "which
 * one is me" is answered the same way on standings, projections and both watch
 * pages. A tint rather than a border: a <tr> cannot carry a left border under
 * border-collapse without the cells fighting it, and the tint survives both
 * themes at the same strength. */
export const MINE_ROW = "bg-primary/10";

export function YouBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-1 shrink-0 rounded-sm bg-primary px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wide text-primary-foreground",
        className,
      )}
    >
      You
    </span>
  );
}

/** Callout box — vanilla .wi-note. */
export function Note({
  children, tone = "default",
}: { children: React.ReactNode; tone?: "default" | "warn" }) {
  return (
    <div
      className={cn(
        "mb-4 rounded-lg border border-l-4 bg-card px-3 py-2.5 text-sm text-muted-foreground sm:mb-6 sm:px-4 sm:py-3",
        tone === "warn" ? "border-l-warn" : "border-l-primary",
      )}
    >
      {children}
    </div>
  );
}
