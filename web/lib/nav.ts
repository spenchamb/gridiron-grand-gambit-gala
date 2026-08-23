import {
  Home, Clock, Sigma, ScrollText, Swords, ListOrdered, Users, Sparkles,
  Anchor, HelpCircle, ArrowLeftRight, Star, TriangleAlert, PenLine,
  type LucideIcon,
} from "lucide-react";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/* The migration runs with both stacks live at once: static-web-server serves
   whichever file exists, so a half-ported site works fine. Each entry declares
   which stack owns it —
   
     ported: true   -> a Next route; use next/link, client-side navigation
     ported: false  -> still a vanilla page; use a plain <a> to its .html

   Flip the flag as each page lands in Phase 2 and delete the old .html. Plain
   <a> hrefs need BASE_PATH prepended by hand; next/link applies basePath
   itself, so ported hrefs must NOT include it. */
export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  ported: boolean;
};

export const NAV: NavItem[] = [
  { id: "league",      label: "League",        icon: Home,            href: "/",            ported: true },
  { id: "matchups",    label: "Matchups",      icon: Swords,          href: "/matchups",    ported: true },
  { id: "teams",       label: "Teams",         icon: Users,           href: "/teams",       ported: true },
  { id: "ledger",      label: "Ledger",        icon: ScrollText,      href: "/ledger",      ported: true },
  { id: "waivers",     label: "Waiver Wire",   icon: ListOrdered,     href: "/waivers",     ported: true },
  { id: "trade",       label: "Trade Lab",     icon: ArrowLeftRight,  href: "/trade",       ported: true },
  { id: "whatif",      label: "What-If",       icon: HelpCircle,      href: "/whatif",      ported: true },
  { id: "projections", label: "Projections",   icon: Sigma,           href: "/projections", ported: true },
  { id: "playoff",     label: "Playoff Watch", icon: Star,            href: "/playoff",     ported: true },
  { id: "punish",      label: "Punish Watch",  icon: TriangleAlert,   href: "/punish",      ported: true },
  { id: "recap",       label: "Last Week",     icon: Clock,           href: "/recap",       ported: true },
  { id: "draft",       label: "Draft",         icon: Sparkles,        href: "/draft",       ported: true },
  { id: "keepers",     label: "Keepers",       icon: Anchor,          href: "/keepers",     ported: true },
  { id: "changelog",   label: "Changelog",     icon: PenLine,         href: "/changelog",   ported: true },
];

/* Sidebar sections. The taxonomy is GGGG's own — it is the grouping the vanilla
   mobile "More" sheet already used (Tools / Races / Reference), extended with a
   primary League group. The *presentation* follows firstdown.studio: a labelled
   group per section, three or four items each, rather than one long flat list. */
export const NAV_GROUPS: { label: string; ids: string[] }[] = [
  { label: "League",    ids: ["league", "matchups", "teams", "ledger"] },
  { label: "Tools",     ids: ["waivers", "trade", "whatif"] },
  { label: "Races",     ids: ["projections", "playoff", "punish"] },
  { label: "Reference", ids: ["recap", "draft", "keepers", "changelog"] },
];

export const byId = (id: string) => NAV.find((n) => n.id === id)!;

/** Absolute href for a legacy (unported) page. */
export const legacyHref = (href: string) => `${BASE_PATH}${href}`;

/* The vanilla sidebar had three expandable groups. They are restored here now
   that team/ and draft/ are ported — Teams lists managers, Draft lists seasons,
   What-If deep-links to the sections on that page (which keep their #sec-* ids
   for exactly this reason). Sub-items are built at render time from meta.json
   and teams.json, so only the What-If set is static. */
export const WHATIF_SECTIONS: [string, string][] = [
  ["#sec-scoring", "Scoring Systems"],
  ["#sec-notrade", "No Trades"],
  ["#sec-median", "Median Format"],
  ["#sec-seeding", "Playoff Seeding"],
];

/** Which nav entries own a submenu, keyed by NavItem id. */
export const GROUPED = new Set(["teams", "draft", "whatif"]);

/* static-web-server resolves /sleeper/draft, /sleeper/draft/ and
   /sleeper/draft.html to the same export, so a visitor can arrive on any of
   them — and every pre-migration bookmark is the .html form. usePathname
   reports the URL as-is (minus basePath), so normalise before comparing
   against NAV hrefs or nothing matches and the sidebar shows no active item. */
export const routePath = (pathname: string) => {
  const p = pathname.replace(/\.html$/, "").replace(/\/+$/, "");
  return p === "" ? "/" : p;
};
