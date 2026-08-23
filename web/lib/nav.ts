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
  { id: "league",      label: "League",        icon: Home,            href: "/index.html",       ported: false },
  { id: "recap",       label: "Last Week",     icon: Clock,           href: "/recap",            ported: true  },
  { id: "projections", label: "Projections",   icon: Sigma,           href: "/projections.html", ported: false },
  { id: "ledger",      label: "Ledger",        icon: ScrollText,      href: "/ledger",           ported: true  },
  { id: "matchups",    label: "Matchups",      icon: Swords,          href: "/matchups.html",    ported: false },
  { id: "waivers",     label: "Waiver Wire",   icon: ListOrdered,     href: "/waivers",          ported: true  },
  { id: "teams",       label: "Teams",         icon: Users,           href: "/teams",            ported: true  },
  { id: "draft",       label: "Draft",         icon: Sparkles,        href: "/draft.html",       ported: false },
  { id: "keepers",     label: "Keepers",       icon: Anchor,          href: "/keepers",          ported: true  },
  { id: "whatif",      label: "What-If",       icon: HelpCircle,      href: "/whatif.html",      ported: false },
  { id: "trade",       label: "Trade Lab",     icon: ArrowLeftRight,  href: "/trade.html",       ported: false },
  { id: "playoff",     label: "Playoff Watch", icon: Star,            href: "/playoff",          ported: true  },
  { id: "punish",      label: "Punish Watch",  icon: TriangleAlert,   href: "/punish",           ported: true  },
  { id: "changelog",   label: "Changelog",     icon: PenLine,         href: "/changelog",        ported: true  },
];

/** Absolute href for a legacy (unported) page. */
export const legacyHref = (href: string) => `${BASE_PATH}${href}`;
