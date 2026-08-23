/* Shapes transcribed from the live data/changelog.json (27 entries). */
export type ChangelogItem = { h: string; d: string };

export type ChangelogEntry = {
  date: string;
  tag: string;
  title: string;
  summary?: string;
  items?: ChangelogItem[];
};

export type Changelog = { entries: ChangelogEntry[] };

/* The vanilla page's TAGS map covers feature/fix/infra/docs and falls through to
   a generic "Update" for anything else. The live data also carries `improved`
   (twice), so those two entries have been silently rendering as "Update" —
   named properly here rather than carried forward. */
export const TAGS: Record<string, { label: string; className: string }> = {
  feature:  { label: "Feature",        className: "bg-primary text-primary-foreground" },
  improved: { label: "Improved",       className: "bg-ok text-background" },
  fix:      { label: "Fix",            className: "bg-warn text-background" },
  infra:    { label: "Infrastructure", className: "bg-info text-background" },
  docs:     { label: "Docs",           className: "bg-secondary text-muted-foreground border" },
};

export const tagOf = (tag: string) =>
  TAGS[tag] ?? { label: "Update", className: "bg-secondary text-muted-foreground border" };
