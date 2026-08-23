"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NAV, WHATIF_SECTIONS, GROUPED, legacyHref, routePath, type NavItem } from "@/lib/nav";
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
        try {
          sessionStorage.setItem("gggg-teams", JSON.stringify(t));
        } catch {}
      }
      if (m) {
        setMeta(m);
        try {
          sessionStorage.setItem("gggg-meta", JSON.stringify(m));
        } catch {}
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

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const inner = (
    <>
      <Icon />
      <span>{item.label}</span>
    </>
  );
  return (
    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
      {item.ported ? (
        <Link href={item.href}>{inner}</Link>
      ) : (
        <a href={legacyHref(item.href)}>{inner}</a>
      )}
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const pathname = routePath(usePathname());
  const params = useSearchParams();
  const { teams, meta, draftSeasons } = useSubItems();
  const owner = params.get("owner");
  const season = params.get("season");

  const isActive = (item: NavItem) => item.ported && pathname === item.href;

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
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <a href={legacyHref("/index.html")}>
                <span className="font-mono text-lg tracking-tight text-primary">GGGG</span>
                <span className="text-xs text-muted-foreground">Fantasy Football</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map((item) => {
              if (!GROUPED.has(item.id))
                return (
                  <SidebarMenuItem key={item.id}>
                    <NavLink item={item} active={isActive(item)} />
                  </SidebarMenuItem>
                );

              const subs = subFor(item.id);
              const openByDefault =
                isActive(item) || subs.some((s) => s.active) ||
                (item.id === "teams" && pathname === "/team") ||
                (item.id === "draft" && pathname === "/draft");

              return (
                <Collapsible
                  key={item.id}
                  asChild
                  defaultOpen={openByDefault}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <NavLink item={item} active={isActive(item)} />
                    {subs.length > 0 && (
                      <>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Toggle ${item.label} menu`}
                            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-transform hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden group-data-[state=open]/collapsible:rotate-90"
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
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 pb-1 font-mono text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          {meta ? `Updated ${relTime(meta.generated_at)}` : ""}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
