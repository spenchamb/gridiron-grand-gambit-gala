# Route ownership during the migration

Both stacks are live at once. static-web-server serves whichever file exists,
so a half-ported site works — but that also means **this export must never emit
a file that a still-vanilla page owns**, or the rsync silently overwrites it.

Two rules follow:

1. **No root `app/page.tsx` until `index.html` is ported.** A root route exports
   as `out/index.html`, which is the live league hub. It is the last page to
   port (three modes, ~860 lines), so it is also the last route to add.

2. **Add the Next route and delete the vanilla `.html` in the same commit**, and
   flip `ported: true` in `lib/nav.ts` at the same time. Leaving both in place
   means the export wins and the vanilla page becomes unreachable-but-present,
   which is the confusing failure mode.

`redirect()` is unsupported under `output: "export"` — there is no server to
issue a 3xx. Use a link, or a client-side `router.replace`.

## Porting index.html — the last page

It is the only vanilla page left. Three things are already prepared:

- **Types** for all four files it reads are in `lib/data.ts` under the
  "index.html (the League hub)" banner: `LeagueFile`, `HistoryFile`, `NowFile`,
  `PreseasonFile`. Nothing imports them yet.
- **Its two charts** are already ported: `AllTimeBars` and `ChampionsLedger` in
  `components/gggg/viz.tsx` consume `history.all_time` and `history.seasons`
  as-is.
- **Every other route it links to** is ported, so its links are `next/link`
  throughout — no `legacyHref` needed anywhere on it.

**Mode selection** (the vanilla page drives this with a body class and flex
`order`):

| condition | mode |
|---|---|
| `preseason.json.active` | preseason — draft not held; upcoming settings + change diff + keepers |
| `now.json.active` | in-season — leads with live matchups, pushes evergreen reference down |
| otherwise | complete — history is the headline |

**The one hard rule:** adding `app/page.tsx` makes the export emit
`out/index.html`, which is the live league hub. Until that route is complete the
overlay rsync would clobber it. Add the route and `git rm www/sleeper/index.html`
in the same commit — and after that commit, `www/sleeper/` is empty and the
vanilla stack is gone.

**Then, and only then:** `/assets/*` can be deleted. The NBA section already
runs off its own frozen copy at `/assets/legacy/` (see CLAUDE.md §8), so nothing
else depends on it.
