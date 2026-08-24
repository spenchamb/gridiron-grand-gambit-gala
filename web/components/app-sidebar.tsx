"use client";

/* Modelled on firstdown.studio's sidebar, measured from the live site rather
 * than from memory:
 *
 *   variant="sidebar"   content is FLUSH — no margin, radius or shadow. The rail
 *                       is simply a lighter panel (--sidebar) against a darker
 *                       page (--background). It is NOT an inset floating card.
 *   width               15rem / 240px
 *   group label         12px, weight 500, sentence case, no tracking,
 *                       foreground at 70% alpha, 32px tall — and a button, not
 *                       a label: every section collapses and the choice sticks.
 *   group chevron       rotates 90° when open, and fades out entirely unless
 *                       the section is hovered, so an all-open rail is a clean
 *                       list rather than a column of arrows.
 *   menu row            32px tall, 8px padding, 8px radius, 14px text,
 *                       8px gap, 16px icon
 *   header              logo in a plain anchor, not a menu button
 *
 * Two deliberate divergences, both additive:
 *   - collapsible="icon" (FDS uses offcanvas). The icon rail with tooltips is
 *     strictly more capable on a desktop and we already had it working.
 *   - Teams / Draft keep collapsible submenus. FDS has no equivalent; GGGG
 *     needs per-manager and per-season links. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  SidebarRail, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  NAV_GROUPS, GROUPED, byId, routePath, readSections, writeSections, type NavItem,
} from "@/lib/nav";
import { fetchJSON, relTime, type Meta, type Team } from "@/lib/data";
import { TeamAvatar } from "@/components/gggg/primitives";
import { SidebarUtilityMenu } from "@/components/sidebar-utility-menu";
import { TeamSwitcher } from "@/components/team-switcher";

/** Sub-items for the grouped entries, built from live data. */
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

/* Stored expand/collapse state for the nav groups.
 *
 * Loaded in an effect rather than in a useState initialiser on purpose: the
 * export is prerendered at build time, so reading localStorage during the first
 * render would disagree with the served HTML, and a Collapsible mismatch is
 * structural (closed sections are absent from the DOM, not merely hidden).
 * Everything therefore renders open, and a section the visitor had collapsed
 * animates shut immediately after mount — which the height transition makes
 * read as deliberate rather than as a flash. */
function useSections(activeGroup: string | undefined) {
  const [sections, setSections] = useState<Record<string, boolean>>({});

  useEffect(() => setSections(readSections()), []);

  const isOpen = (label: string) => {
    /* The group holding the current page always opens, whatever was stored.
       Landing on a deep link into a collapsed section would otherwise show an
       empty rail with no hint of where you are. */
    if (label === activeGroup) return true;
    return sections[label] ?? true;
  };

  const toggle = (label: string) => {
    setSections((prev) => {
      const next = { ...prev, [label]: !(prev[label] ?? true) };
      writeSections(next);
      return next;
    });
  };

  return { isOpen, toggle };
}

function BrandHeader() {
  return (
    <SidebarHeader className="flex-row items-center gap-1 p-2">
      {/* Icon rail's own toggle — the "G" mark this replaced didn't do
          anything and just duplicated the wordmark below. */}
      <SidebarTrigger className="size-7 shrink-0" />
      <Link
        href="/"
        aria-label="GGGG fantasy home"
        className="flex w-fit min-w-0 items-center rounded-md px-1 py-1 transition-opacity hover:opacity-90 group-data-[collapsible=icon]:hidden"
      >
        {/* gggg-logo-white is the light variant (600x202, 33KB) — the right one
            for a dark rail, and a twelfth the weight of the full-colour PNG.
            It inverts under .light, where the rail is near-white.

            22px matches the mobile top bar exactly. On a phone those two are
            the same logo a tap apart — the bar behind the closed drawer and the
            drawer's own header — and at 26px it visibly grew on opening. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/gggg-logo-white.png`}
          alt="The Gridiron Grand Gambit Gala"
          width={124}
          height={42}
          className="h-[22px] w-auto shrink-0 [.light_&]:invert"
        />
      </Link>
    </SidebarHeader>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      asChild
      isActive={active}
      tooltip={item.label}
      onClick={() => isMobile && setOpenMobile(false)}
    >
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
  const { isMobile, setOpenMobile, state } = useSidebar();
  const owner = params.get("owner");
  const season = params.get("season");

  const isActive = (item: NavItem) => pathname === item.href;

  /* Which section the current route sits in — including the two routes that are
     reached only through a submenu and so have no NAV entry of their own. */
  const activeGroup = NAV_GROUPS.find((g) =>
    g.ids.some(
      (id) =>
        isActive(byId(id)) ||
        (id === "teams" && pathname === "/team") ||
        (id === "draft" && pathname === "/draft"),
    ),
  )?.label;

  const { isOpen, toggle } = useSections(activeGroup);

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
    return draftSeasons.map((s) => ({
      key: s,
      href: { pathname: "/draft", query: { season: s } },
      active: pathname === "/draft" && season === s,
      node: <span>{s} Draft</span>,
    }));
  };

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <BrandHeader />

      {/* Above the nav, not in it: this sets whose site you are looking at,
          which is a different kind of choice from where you are going. */}
      <TeamSwitcher />

      <SidebarContent className="gap-0 px-1 pb-1.5">
        {NAV_GROUPS.map((group) => (
          <Collapsible
            key={group.label}
            /* On the icon rail the labels are hidden, so a collapsed section
               would silently drop its icons and leave a gap with nothing to
               click. Force every section open there. */
            open={state === "collapsed" ? true : isOpen(group.label)}
            onOpenChange={() => state !== "collapsed" && toggle(group.label)}
            className="group/section"
          >
            <SidebarGroup className="py-1">
              <SidebarGroupLabel
                asChild
                className="h-8 px-2 text-xs font-medium text-sidebar-foreground/70"
              >
                <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 text-left transition-colors hover:text-sidebar-foreground">
                  <span>{group.label}</span>
                  {/* Present but invisible while the section is open, so the
                      rail reads as a plain list until you reach for it. */}
                  <ChevronRight className="size-4 shrink-0 transition-all group-data-[state=open]/section:rotate-90 group-data-[state=open]/section:opacity-0 group-hover/section:opacity-100" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>

              <CollapsibleContent>
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
                                        <SidebarMenuSubButton
                                          asChild
                                          isActive={s.active}
                                          onClick={() => isMobile && setOpenMobile(false)}
                                        >
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
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-1">
        <SidebarUtilityMenu updated={meta ? `Updated ${relTime(meta.generated_at)}` : undefined} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
