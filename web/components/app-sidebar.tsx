"use client";

/* Modelled on firstdown.studio's sidebar, measured from the live site rather
 * than from memory:
 *
 *   variant="sidebar"   content is FLUSH — no margin, radius or shadow. The rail
 *                       is simply a lighter panel (--sidebar) against a darker
 *                       page (--background). It is NOT an inset floating card.
 *   width               15rem / 240px
 *   group label         12px, weight 500, sentence case, no tracking,
 *                       foreground at 70% alpha, 32px tall
 *   menu row            32px tall, 8px padding, 8px radius, 14px text,
 *                       8px gap, 16px icon
 *   header              logo in a plain anchor, not a menu button
 *
 * Two deliberate divergences, both additive:
 *   - collapsible="icon" (FDS uses offcanvas). The icon rail with tooltips is
 *     strictly more capable on a desktop and we already had it working.
 *   - Teams / Draft / What-If keep collapsible submenus. FDS has no equivalent;
 *     GGGG needs per-manager and per-season links. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  NAV_GROUPS, WHATIF_SECTIONS, GROUPED, byId, routePath, type NavItem,
} from "@/lib/nav";
import { fetchJSON, relTime, type Meta, type Team } from "@/lib/data";
import { TeamAvatar } from "@/components/gggg/primitives";

/** Sub-items for the three grouped entries, built from live data. */
function useSubItems() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    /* Seed from the previous page's cached copy so the nav is complete on first
       paint, then revalidate — the vanilla sidebar did the same. */
    try {
      const ct = sessionStorage.getItem("gggg-teams");
      const cm = sessionStorage.getItem("gggg-meta");
      if (ct) setTeams(JSON.parse(ct));
      if (cm) setMeta(JSON.parse(cm));
    } catch {}

    Promise.all([
      fetchJSON<Team[]>("teams.json").catch(() => null),
      fetchJSON<Meta>("meta.json").catch(() => null),
    ]).then(([t, m]) => {
      if (t) {
        setTeams(t);
        try { sessionStorage.setItem("gggg-teams", JSON.stringify(t)); } catch {}
      }
      if (m) {
        setMeta(m);
        try { sessionStorage.setItem("gggg-meta", JSON.stringify(m)); } catch {}
      }
    });
  }, []);

  /* During the offseason meta.draft_seasons omits the upcoming season until it
     has drafted, so surface it explicitly — its pre-draft board is reachable. */
  const draftSeasons = (() => {
    const ds = [...(meta?.draft_seasons ?? [])];
    const t = meta?.nfl_season_type;
    if (
      meta?.nfl_season &&
      ["off", "pre", "pre_draft", "offseason"].includes(String(t)) &&
      !ds.map(String).includes(String(meta.nfl_season))
    )
      ds.unshift(String(meta.nfl_season));
    return ds;
  })();

  return { teams, meta, draftSeasons };
}

function BrandHeader() {
  return (
    <SidebarHeader className="p-2">
      <Link
        href="/"
        aria-label="GGGG fantasy home"
        className="flex w-fit items-center gap-2 rounded-md px-1 py-1 transition-opacity hover:opacity-90"
      >
        {/* Compact mark — the only brand element that survives the icon rail. */}
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
          G
        </span>
        {/* The wordmark already carries the name, so no text sits beside it.
            gggg-logo-white is the light variant (600x202, 33KB) — the right one
            for a dark rail, and a twelfth the weight of the full-colour PNG. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/gggg-logo-white.png`}
          alt="The Gridiron Grand Gambit Gala"
          width={124}
          height={42}
          className="h-[26px] w-auto shrink-0 group-data-[collapsible=icon]:hidden"
        />
      </Link>
    </SidebarHeader>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
      <Link href={item.href}>
        <Icon />
        <span>{item.label}</span>
      </Link>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const pathname = routePath(usePathname());
  const params = useSearchParams();
  const { teams, meta, draftSeasons } = useSubItems();
  const owner = params.get("owner");
  const season = params.get("season");

  const isActive = (item: NavItem) => pathname === item.href;

  const subFor = (id: string) => {
    if (id === "teams")
      return teams.map((t) => ({
        key: t.owner_id,
        href: { pathname: "/team", query: { owner: t.owner_id } },
        active: pathname === "/team" && owner === t.owner_id,
        node: (
          <>
            <TeamAvatar src={t.avatar} name={t.team} className="size-5" />
            <span className="truncate">
              {t.team}
              {t.championships ? " 🏆".repeat(Math.min(t.championships, 2)) : ""}
            </span>
          </>
        ),
      }));
    if (id === "draft")
      return draftSeasons.map((s) => ({
        key: s,
        href: { pathname: "/draft", query: { season: s } },
        active: pathname === "/draft" && season === s,
        node: <span>{s} Draft</span>,
      }));
    return WHATIF_SECTIONS.map(([hash, label]) => ({
      key: hash,
      href: { pathname: "/whatif", hash: hash.slice(1) },
      active: false,
      node: <span>{label}</span>,
    }));
  };

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <BrandHeader />

      <SidebarContent className="gap-0 px-1 pb-1.5">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            {/* 12px, medium, sentence case, 70% alpha — not the uppercase mono
                label the vanilla site used. Hidden on the icon rail. */}
            <SidebarGroupLabel className="h-8 px-2 text-xs font-medium text-sidebar-foreground/70">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.ids.map((id) => {
                  const item = byId(id);
                  if (!GROUPED.has(id))
                    return (
                      <SidebarMenuItem key={id}>
                        <NavRow item={item} active={isActive(item)} />
                      </SidebarMenuItem>
                    );

                  const subs = subFor(id);
                  const openByDefault =
                    isActive(item) ||
                    subs.some((s) => s.active) ||
                    (id === "teams" && pathname === "/team") ||
                    (id === "draft" && pathname === "/draft");

                  return (
                    <Collapsible
                      key={id}
                      asChild
                      defaultOpen={openByDefault}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <NavRow item={item} active={isActive(item)} />
                        {subs.length > 0 && (
                          <>
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Toggle ${item.label} menu`}
                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/60 transition-transform hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden group-data-[state=open]/collapsible:rotate-90"
                              >
                                <ChevronRight className="size-3.5" />
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <SidebarMenuSub>
                                {subs.map((s) => (
                                  <SidebarMenuSubItem key={s.key}>
                                    <SidebarMenuSubButton asChild isActive={s.active}>
                                      <Link href={s.href}>{s.node}</Link>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                ))}
                              </SidebarMenuSub>
                            </CollapsibleContent>
                          </>
                        )}
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-3 pb-2">
        <span className="truncate font-mono text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          {meta ? `Updated ${relTime(meta.generated_at)}` : ""}
        </span>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
