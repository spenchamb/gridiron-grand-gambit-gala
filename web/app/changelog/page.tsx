"use client";

import { useEffect, useState } from "react";
import { fetchJSON, relTime, type Meta } from "@/lib/data";
import { tagOf, type Changelog, type ChangelogEntry } from "@/lib/changelog";

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [updated, setUpdated] = useState<string>("");
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchJSON<Changelog>("changelog.json"),
      fetchJSON<Meta>("meta.json").catch(() => null),
    ])
      .then(([c, m]) => {
        setEntries(c.entries);
        if (m) setUpdated(`Site data updated ${relTime(m.generated_at)}`);
      })
      .catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-20 pt-10">
      <header className="mb-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          What&apos;s New
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Changelog</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every change to the site, explained — newest first.
        </p>
      </header>

      <p className="mb-8 h-4 font-mono text-xs text-muted-foreground">{updated}</p>

      {error && <p className="text-sm text-muted-foreground">Could not load changelog.</p>}

      {!entries && !error && (
        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      )}

      {entries && (
        <div>
          {entries.map((en, i) => {
            const tag = tagOf(en.tag);
            const last = i === entries.length - 1;
            return (
              <article key={`${en.date}-${i}`} className="flex gap-4">
                {/* Rail: a connecting line behind a dot, hidden on the last entry. */}
                <div className="relative w-3.5 shrink-0">
                  {!last && (
                    <span className="absolute left-1.5 top-1.5 -bottom-2 w-px bg-border" />
                  )}
                  <span className="absolute left-0 top-1 size-3 rounded-full border-2 border-primary bg-background" />
                </div>

                <div className="min-w-0 flex-1 pb-8">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${tag.className}`}
                    >
                      {tag.label}
                    </span>
                    <time className="font-mono text-xs tabular-nums text-muted-foreground">
                      {en.date}
                    </time>
                  </div>

                  <h2 className="text-xl font-extrabold leading-tight">{en.title}</h2>

                  {en.summary && (
                    <p className="mt-1.5 text-sm text-muted-foreground">{en.summary}</p>
                  )}

                  {en.items && en.items.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2">
                      {en.items.map((it, j) => (
                        <li key={j} className="relative pl-5 text-sm leading-relaxed">
                          <span
                            aria-hidden
                            className="absolute left-0 text-primary/60"
                          >
                            &#9657;
                          </span>
                          <strong className="font-semibold text-foreground">{it.h}.</strong>{" "}
                          <span className="text-muted-foreground">{it.d}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
