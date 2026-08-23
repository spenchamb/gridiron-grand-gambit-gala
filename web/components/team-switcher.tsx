"use client";

/* The "my team" picker, directly under the brand in the sidebar.
 *
 * Shaped like shadcn's team switcher because that is the control people already
 * read as "which identity am I in" — avatar, name, and a chevron, sitting above
 * the navigation rather than inside it. Collapses to just the avatar on the
 * icon rail, which is exactly the affordance that still makes sense there. */

import { Check, ChevronsUpDown, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
import { TeamAvatar } from "@/components/gggg/primitives";
import { useMe, setMyTeam } from "@/lib/me";
import { cn } from "@/lib/utils";

export function TeamSwitcher() {
  const me = useMe();
  const { isMobile, setOpenMobile } = useSidebar();

  /* Nothing useful to offer until teams.json lands. A placeholder of the same
     height keeps the nav below it from jumping when it does. */
  if (!me.ready)
    return <div className="mx-1 h-11 shrink-0 rounded-md group-data-[collapsible=icon]:mx-0" />;

  const choose = (ownerId: string | null) => {
    setMyTeam(ownerId);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label={me.team ? `My team: ${me.team.team}. Change` : "Choose my team"}
        className={cn(
          "mx-1 flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left outline-none transition-colors",
          "hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          "group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
          me.team && "border-sidebar-border",
        )}
      >
        {me.team ? (
          <TeamAvatar src={me.team.avatar} name={me.team.team} className="size-7" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-secondary">
            <Users className="size-3.5 text-muted-foreground" />
          </span>
        )}
        <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
            My team
          </span>
          <span className="block truncate text-xs font-bold">
            {me.team ? me.team.team : "Whole league"}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="max-h-[min(24rem,60vh)] w-[calc(var(--sidebar-width)-0.5rem)] overflow-y-auto"
      >
        <div className="px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
          Lead every page with
        </div>

        <Row
          selected={!me.ownerId}
          onSelect={() => choose(null)}
          icon={
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-secondary">
              <Users className="size-3 text-muted-foreground" />
            </span>
          }
          label="Whole league"
          sub="No team highlighted"
        />

        <div className="my-1 h-px bg-border" />

        {me.teams.map((t) => (
          <Row
            key={t.owner_id}
            selected={me.ownerId === t.owner_id}
            onSelect={() => choose(t.owner_id)}
            icon={<TeamAvatar src={t.avatar} name={t.team} className="size-6" />}
            label={t.team}
            sub={t.owner}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Row({
  selected, onSelect, icon, label, sub,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold">{label}</span>
        {sub ? (
          <span className="block truncate text-[10px] text-muted-foreground">{sub}</span>
        ) : null}
      </span>
      <Check className={cn("size-3.5 shrink-0 text-primary", !selected && "invisible")} />
    </button>
  );
}
