"use client";

/* League settings, moved off the League hub so that page can stay on the
   standings and the numbers. Reads the same league.json meta the hub did. */

import { useEffect, useState } from "react";
import { fetchJSON, relTime, type LeagueFile, type Meta } from "@/lib/data";
import { PageHeader } from "@/components/gggg/primitives";
import { LeagueSetup } from "@/components/gggg/league-sections";

export default function SettingsPage() {
  const [league, setLeague] = useState<LeagueFile | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([fetchJSON<LeagueFile>("league.json"), fetchJSON<Meta>("meta.json").catch(() => null)])
      .then(([l, m]) => {
        setLeague(l);
        setMeta(m);
      })
      .catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10">
      <PageHeader
        title="League Settings"
        subtitle={league ? `${league.meta.season} season · scoring, roster and playoff format` : "Scoring, roster and playoff format"}
        updated={meta ? `Updated ${relTime(meta.generated_at)}` : undefined}
      />
      {error && <p className="text-sm text-muted-foreground">Could not load league settings.</p>}
      {!league && !error && <div className="h-64 animate-pulse rounded-lg border bg-card" />}
      {league && <LeagueSetup meta={league.meta} />}
    </div>
  );
}
