"use client";

/* The "my team" picker, directly under the brand in the sidebar.
 *
 * Shaped like shadcn's team switcher because that is the control people already
 * read as "which identity am I in" — avatar, name, and a chevron, sitting above
 * the navigation rather than inside it. Collapses to just the avatar on the
 * icon rail, which is exactly the affordance that still makes sense there.
 *
 * The list is a popover on a desktop and an inline expander on a phone, because
 * on a phone a popover cannot both sit still and scroll:
 *
 *   The mobile sidebar is a Sheet — a Radix Dialog. It carries a transform
 *   while it animates, and a transformed element is the containing block for
 *   its position:fixed descendants, so a popover portaled *into* the sheet
 *   inherits the drawer's offset and lands off-screen. Portaling to <body>
 *   fixes the position but puts the list outside the dialog subtree, where
 *   react-remove-scroll blocks touchmove — thirteen teams, five of them
 *   unreachable, scrollable by mouse wheel and immovable under a thumb.
 *
 * Inline has neither problem: no portal, no positioning, and it scrolls because
 * it is inside the lock. It is also simply the better control at 281px wide. */

import { useState } from "react";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
import { TeamAvatar } from "@/components/gggg/primitives";
import { useMe, setMyTeam, type MeState } from "@/lib/me";
import { cn } from "@/lib/utils";

const TRIGGER_CLASS = cn(
  "mx-1 flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left outline-none transition-colors",
  "hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
  "group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
);

function TriggerFace({ me }: { me: MeState }) {
  return (
    <>
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
    </>
  );
}

function Options({
  me, onChoose,
}: { me: MeState; onChoose: (ownerId: string | null) => void }) {
  return (
    <>
      <div className="px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
        Lead every page with
      </div>

      <Row
        selected={!me.ownerId}
        onSelect={() => onChoose(null)}
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
          onSelect={() => onChoose(t.owner_id)}
          icon={<TeamAvatar src={t.avatar} name={t.team} className="size-6" />}
          label={t.team}
          sub={t.owner}
        />
      ))}
    </>
  );
}

export function TeamSwitcher() {
  const me = useMe();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const [open, setOpen] = useState(false);

  /* Nothing useful to offer until teams.json lands. A placeholder of the same
     height keeps the nav below it from jumping when it does. */
  if (!me.ready)
    return <div className="mx-1 h-11 shrink-0 rounded-md group-data-[collapsible=icon]:mx-0" />;

  const label = me.team ? `My team: ${me.team.team}. Change` : "Choose my team";

  if (isMobile) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(TRIGGER_CLASS, "w-[calc(100%-0.5rem)]", me.team && "border-sidebar-border")}
        >
          <TriggerFace me={me} />
        </button>
        {open && (
          /* Its own scroller, inside the dialog, so touch scrolling is allowed.
             Capped so the nav underneath never disappears entirely. */
          <div className="mx-1 mt-1 max-h-[45vh] overflow-y-auto rounded-lg border bg-popover p-1">
            <Options
              me={me}
              onChoose={(id) => {
                setMyTeam(id);
                setOpen(false);
                setOpenMobile(false);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn(TRIGGER_CLASS, me.team && "border-sidebar-border")}
      >
        <TriggerFace me={me} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        /* On the icon rail the trigger is 32px wide, so sizing to the rail
           would give a 32px menu — pin a usable width instead. */
        className={cn(
          "max-h-[min(24rem,60vh)] overflow-y-auto",
          state === "collapsed" ? "w-64" : "w-[calc(var(--sidebar-width)-0.5rem)]",
        )}
      >
        <Options me={me} onChoose={(id) => setMyTeam(id)} />
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
