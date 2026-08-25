"use client";

/* Publishes the selected team's colour pair onto <html>.
 *
 * Renders nothing. It writes two custom properties and lets globals.css choose
 * between them per theme — see the --team block there. Written to the document
 * element rather than a wrapper so that portalled content (the sidebar sheet,
 * every popover) inherits it too; those mount on <body>, outside any wrapper a
 * layout could provide.
 *
 * Cleared when no team is selected, which is what lets --team fall back to the
 * brand tan instead of keeping the last manager's colour. */

import { useEffect } from "react";
import { useMe } from "@/lib/me";
import { pairFor } from "@/lib/team-theme";

export function TeamTheme() {
  const me = useMe();

  useEffect(() => {
    const root = document.documentElement;
    const pair = pairFor(me.ownerId);
    if (pair) {
      root.style.setProperty("--team-bright", pair.bright);
      root.style.setProperty("--team-deep", pair.deep);
    } else {
      root.style.removeProperty("--team-bright");
      root.style.removeProperty("--team-deep");
    }
  }, [me.ownerId]);

  return null;
}
