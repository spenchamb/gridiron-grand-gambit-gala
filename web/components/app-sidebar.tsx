"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import { NAV, legacyHref } from "@/lib/nav";

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <a href={legacyHref("/index.html")}>
                <span className="font-mono text-lg tracking-tight text-primary">GGGG</span>
                <span className="text-muted-foreground text-xs">Fantasy Football</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = item.ported && pathname === item.href;
              return (
                <SidebarMenuItem key={item.id}>
                  {/* Ported routes navigate client-side; the rest are still
                      vanilla pages and need a full document load. */}
                  <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                    {item.ported ? (
                      <Link href={item.href}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    ) : (
                      <a href={legacyHref(item.href)}>
                        <Icon />
                        <span>{item.label}</span>
                      </a>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
