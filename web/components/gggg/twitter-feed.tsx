"use client";

/* League chatter — one aggregated X timeline.
 *
 * The four accounts are shown as a single feed, not four tabs. X's embed API
 * has exactly one way to do that: a List timeline. One <a class="twitter-timeline">
 * pointing at a list renders every account in it, interleaved, in one iframe —
 * which is also the only version of this worth shipping on mobile, where four
 * separate third-party frames would be four times the payload for a rail most
 * people scroll past.
 *
 * LIST_ID is the league's X list (https://x.com/i/lists/2094057473783054762),
 * which holds the four accounts below. It has to stay public — the embed is
 * fetched anonymously, and a private list renders as an empty timeline that is
 * indistinguishable from a rate limit. Whenever X declines to serve the embed,
 * the card falls back to the aggregated account list.
 *
 * X fails often here, and the failure is quiet: ad filtering blocks the script
 * outright, and the anonymous syndication endpoint is aggressively rate
 * limited, in which case widgets.js still builds an iframe but leaves it
 * hidden at 0x0. "Did an iframe appear" is therefore not a usable success
 * test; `rendered()` below measures the frame instead. */

import { useEffect, useRef, useState } from "react";

const LIST_ID: string | null = "2094057473783054762";

const ACCOUNTS = [
  { handle: "GambitGala", note: "the league" },
  { handle: "AdamSchefter", note: "news" },
  { handle: "UnderdogNFL", note: "fantasy" },
  { handle: "RotowireNFL", note: "fantasy" },
] as const;

const SRC = "https://platform.twitter.com/widgets.js";

declare global {
  interface Window {
    twttr?: { widgets?: { load?: (el?: HTMLElement) => void } };
  }
}

/* Resolves once widgets.js is on the page, whoever put it there. Rejects on a
   network/blocked failure so the caller can fall back rather than spin. */
function loadWidgets(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (window.twttr?.widgets?.load) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
  const el = existing ?? Object.assign(document.createElement("script"), { src: SRC, async: true });

  return new Promise((resolve, reject) => {
    el.addEventListener("load", () => resolve());
    el.addEventListener("error", () => reject(new Error("blocked")));
    if (!existing) document.head.appendChild(el);
  });
}

const isDark = () => !document.documentElement.classList.contains("light");

function Accounts() {
  return (
    <ul className="divide-y">
      {ACCOUNTS.map((a) => (
        <li key={a.handle}>
          <a
            href={`https://x.com/${a.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 px-3 py-3 text-sm transition-colors hover:bg-secondary/40"
          >
            <span className="truncate font-bold">@{a.handle}</span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {a.note}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function TwitterFeed({ className }: { className?: string }) {
  /* No list configured means no third-party script at all — going straight to
     the fallback keeps ~200 KB off every mobile load. */
  const [state, setState] = useState<"loading" | "ready" | "failed">(
    LIST_ID ? "loading" : "failed",
  );
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const host = useRef<HTMLDivElement>(null);

  /* The theme lives on <html> and is flipped by a plain class toggle, so there
     is no event to listen to — MutationObserver is the only signal. widgets.js
     reads data-theme once at load and cannot be re-themed in place, so a flip
     has to tear the iframe down and rebuild it: that is what `theme` in the
     effect key below does. */
  useEffect(() => {
    setTheme(isDark() ? "dark" : "light");
    const obs = new MutationObserver(() => setTheme(isDark() ? "dark" : "light"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!LIST_ID) return;
    let cancelled = false;
    const timers: number[] = [];
    const mount = host.current;
    if (!mount) return;

    setState("loading");
    mount.replaceChildren();

    const anchor = document.createElement("a");
    anchor.className = "twitter-timeline";
    anchor.href = `https://x.com/i/lists/${LIST_ID}`;
    anchor.setAttribute("data-theme", theme);
    anchor.setAttribute("data-height", "520");
    anchor.setAttribute("data-chrome", "noheader nofooter transparent");
    anchor.setAttribute("data-dnt", "true");
    mount.appendChild(anchor);

    loadWidgets()
      .then(() => {
        if (cancelled) return;
        window.twttr?.widgets?.load?.(mount);
        /* widgets.load gives no per-element callback worth trusting, so poll
           for a frame that has actually been given a height. A rate-limited or
           empty timeline sits at 0px forever, which is the case that has to
           reach the fallback rather than render as a blank card. */
        const rendered = () => {
          const f = mount.querySelector("iframe");
          return !!f && f.getBoundingClientRect().height > 40;
        };
        const started = Date.now();
        const tick = window.setInterval(() => {
          if (cancelled) return window.clearInterval(tick);
          if (rendered()) {
            window.clearInterval(tick);
            setState("ready");
          } else if (Date.now() - started > 8000) {
            window.clearInterval(tick);
            setState("failed");
          }
        }, 400);
        timers.push(tick);
      })
      .catch(() => !cancelled && setState("failed"));

    return () => {
      cancelled = true;
      timers.forEach(window.clearInterval);
    };
  }, [theme]);

  return (
    <aside className={className}>
      <div className="overflow-hidden rounded-lg border bg-card">
        {/* Collapsed with h-0 rather than `hidden` while it loads: widgets.js
            sizes the timeline to its container's width, and display:none
            measures 0. */}
        {LIST_ID && (
          <div
            ref={host}
            className={state === "ready" ? "px-3 py-2" : "h-0 overflow-hidden"}
            aria-hidden={state !== "ready"}
          />
        )}

        {state === "loading" && (
          <div className="m-3 h-[280px] animate-pulse rounded-md bg-secondary/60" />
        )}

        {state === "failed" && <Accounts />}
      </div>
    </aside>
  );
}
