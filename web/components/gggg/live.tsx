"use client";

/* Keeping an open page in sync with the live build.
 *
 * The data pipeline refreshes every five minutes inside an NFL hot window, and
 * until this existed none of that reached anyone: the League hub fetched
 * now.json once on mount and then sat there. A phone left open on the
 * scoreboard through the 1pm slate showed the same numbers at 4pm — the one
 * moment the site is actually being watched.
 *
 * Three rules, all of them about not being a nuisance:
 *
 *   nothing while hidden   A backgrounded tab polls nothing. Phones background
 *                          tabs constantly, and a scoreboard nobody is looking
 *                          at is not worth a request.
 *   catch up on return     Coming back to the tab refetches immediately rather
 *                          than waiting out the interval, which is what makes
 *                          unlocking the phone feel instant.
 *   only when it moves     Enabled by the caller, for live and pre-kickoff
 *                          weeks only. A finished week is not going to change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Server-side cadence. Polling faster than the builder writes buys nothing. */
export const LIVE_MS = 60_000;
export const PRE_MS = 180_000;

export type AutoRefresh = {
  /** When the last successful refetch landed, ms epoch; null until the first. */
  at: number | null;
  busy: boolean;
  refresh: () => void;
};

export function useAutoRefresh(
  reload: () => Promise<unknown> | unknown,
  { enabled, intervalMs = LIVE_MS }: { enabled: boolean; intervalMs?: number },
): AutoRefresh {
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  /* The caller passes a fresh closure every render; holding it in a ref keeps
     the interval from being torn down and rebuilt sixty times a minute. */
  const ref = useRef(reload);
  ref.current = reload;

  const run = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    setBusy(true);
    try {
      await ref.current();
      setAt(Date.now());
    } catch {
      /* A failed poll is not worth surfacing: the previous data is still on
         screen and correct-as-of its stamp, and the next tick will retry. */
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let id = window.setInterval(run, intervalMs);
    const onVisibility = () => {
      window.clearInterval(id);
      if (!document.hidden) {
        run();
        id = window.setInterval(run, intervalMs);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, run]);

  return { at, busy, refresh: run };
}

/** Re-renders its caller on a timer, so a relative stamp ages by itself. */
function useTick(ms: number, enabled: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

const ago = (at: number) => {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
};

/** Live pill: says the page is keeping itself current, and refreshes on tap.
 *
 *  The tap target is the point on a phone — the automatic tick is every minute,
 *  and someone watching a red-zone possession wants the number NOW. */
export function LiveBadge({
  live, refresh, className,
}: { live: AutoRefresh; refresh?: boolean; className?: string }) {
  useTick(10_000, true);
  return (
    <button
      type="button"
      onClick={live.refresh}
      aria-label="Refresh scores now"
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 py-1",
        "font-mono text-[11px] uppercase tracking-wider transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <span className="relative flex size-2">
        {refresh && !live.busy && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            live.busy ? "bg-warn" : refresh ? "bg-ok" : "bg-muted-foreground",
          )}
        />
      </span>
      {live.busy ? "Updating…" : live.at ? `Updated ${ago(live.at)}` : "Live"}
    </button>
  );
}
