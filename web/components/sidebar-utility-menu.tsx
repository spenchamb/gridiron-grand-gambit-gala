"use client";

/* The sidebar footer's one button.
 *
 * firstdown.studio keeps appearance and every meta link (About, Changelog,
 * Contact, Privacy, Terms) behind a single small footer control rather than
 * stacking them in the rail, which is what stops a footer from growing into a
 * second nav. GGGG has one meta page today — Changelog — so this starts small
 * on purpose: the point is that the next one costs a line here instead of a
 * row in Reference. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Moon, PenLine, Sun } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function ThemeChoice() {
  /* Rendered from state rather than read straight off <html> so the two halves
     stay in sync after a click. Seeded in an effect, not in useState, because
     the prerendered markup cannot know the visitor's stored choice. */
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => setThemeState(getTheme()), []);

  const choose = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };

  return (
    <div className="px-2 py-1.5">
      <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
        Appearance
      </div>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex gap-1 rounded-md bg-secondary p-1"
      >
        {([
          ["dark", "Dark", Moon],
          ["light", "Light", Sun],
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => choose(value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              theme === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SidebarUtilityMenu({ updated }: { updated?: string }) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Appearance and site info"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      >
        <MoreHorizontal className="size-4 shrink-0" />
        <span className="truncate font-mono text-[10px] group-data-[collapsible=icon]:hidden">
          {updated ?? ""}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[calc(var(--sidebar-width)-1rem)]">
        <ThemeChoice />
        <div className="my-1 h-px bg-border" />
        <Link
          href="/changelog"
          onClick={() => isMobile && setOpenMobile(false)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
        >
          <PenLine className="size-4 shrink-0 text-muted-foreground" />
          Changelog
        </Link>
      </PopoverContent>
    </Popover>
  );
}
