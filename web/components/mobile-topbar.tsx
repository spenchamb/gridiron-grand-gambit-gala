"use client";

/* Mobile top bar.
 *
 * Below the sidebar's md breakpoint the rail is replaced by an off-canvas
 * Sheet — which needs something to open it. Without this bar there is no
 * trigger anywhere on a phone and the navigation is simply unreachable.
 *
 * Matches firstdown.studio's: fixed to the top, h-12, hairline bottom border,
 * translucent background with a backdrop blur, hamburger then brand.
 *
 * The trigger IS the hamburger (shadcn's PanelLeftIcon) — no separate "G"
 * mark belongs next to it, that was a duplicate brand element left over
 * from the desktop header. */

import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function MobileTopbar() {
  return (
    <div className="fixed left-0 top-0 z-50 w-full md:hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur">
        <SidebarTrigger className="-ml-1 size-7 shrink-0" />
        <Link href="/" aria-label="GGGG fantasy home" className="flex min-w-0 flex-1 items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/gggg-logo-white.png`}
            alt="The Gridiron Grand Gambit Gala"
            width={124}
            height={42}
            className="h-[22px] w-auto"
          />
        </Link>
      </header>
    </div>
  );
}
