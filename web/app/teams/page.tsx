"use client";

import { useEffect, useState } from "react";
import { fetchJSON, type Team } from "@/lib/data";

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJSON<Team[]>("teams.json").then(setTeams).catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-20 pt-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Fantasy Football
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Teams</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every manager in the league, all-time.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load teams — {error}
        </p>
      )}

      {!teams && !error && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      )}

      {teams && (
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => (
            <article
              key={t.owner_id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40"
            >
              {t.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.avatar}
                  alt=""
                  loading="lazy"
                  className="size-10 shrink-0 rounded-full bg-secondary object-cover"
                />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">
                  {t.team.slice(0, 2).toUpperCase()}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {t.team}
                  {t.championships > 0 && (
                    <span className="ml-1" title={`${t.championships} championship(s)`}>
                      {"\u{1F3C6}".repeat(Math.min(t.championships, 2))}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">{t.owner}</p>
              </div>

              <div className="shrink-0 text-right font-mono">
                <p className="text-sm font-bold">{t.record}</p>
                <p className="text-xs text-muted-foreground">
                  {t.pf.toLocaleString(undefined, { maximumFractionDigits: 0 })} PF
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
