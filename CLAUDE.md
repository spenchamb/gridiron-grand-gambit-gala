# CLAUDE.md — agent guide for the GGGG fantasy-football site

You are working on **The Gridiron Grand Gambit Gala (GGGG)** — a fantasy-football
league dashboard. This file is the single source of truth for how the app is
built, how to run and test it locally, and how changes reach production. Read it
fully before making changes.

**Golden rule: the default branch (`main`) auto-deploys to the live site within
~5 minutes of a push. Never push to `main` until you have run and verified the
change locally.** You cannot deploy or roll back from your machine — deployment
happens on the owner's home server. Your only lever is git; test before you push.

---

## 0. Read this first — the migration is complete

The front end is a **Next.js static export** (`web/`). All 16 pages are Next
routes; `www/sleeper/` holds only the gitignored `data/` directory. There is no
vanilla page left and no two-stack overlay.

Production runs it as of 2026-08-23:

| | port | mount | build |
|---|---|---|---|
| personal site | 380 | GGGG under `/sleeper` | `npm run build:site` |
| `.xyz` FF mirror | 381 | flattened at `/` | `npm run build:ffb` |
| beta | 383 | `/sleeper` | `build:site`, from `next-phase-1` |

**Do not reintroduce vanilla pages.** If you are adding or changing a GGGG page,
it goes in `web/`. The only vanilla things left on the server are the NBA
section and the War Room, both of which are deliberately out of scope (§8).

## 1. What this app is (scope)

- **Data source is the public Sleeper API only** (`https://api.sleeper.app`, no
  key). Python builders in `build/` call it and write display-ready JSON.
- The front end never calls Sleeper directly — it reads the JSON the builders
  produce, **at runtime, in the browser**. This is true of both stacks and is a
  deliberate constraint: the builders rewrite `data/*.json` on cron (every 5 min
  to 6 h), so build-time data would mean rebuilding the site on every tick.
- Scope is **fantasy football only**. See §8 for the NBA section, which has its
  own frozen copy of the old vanilla assets and must not be dragged along.

---

## 2. Architecture

```
Sleeper API ──> build/*.py (cron on server) ──> data/*.json
                                                    │
                              web/ (Next.js, 16 routes, static export)
                                    │                │
                     build:site ────┘                └──── build:ffb
                  basePath=/sleeper                    no basePath
                  DATA_BASE=/sleeper/data              DATA_BASE=/data
                          │                                  │
                  www-data/sleeper (380)              www-ffb (381)
                          └──── both fetch data/*.json in the browser ────┘
```

### Builders (`build/`) — unchanged by the migration
- **`sleeper-update.py`** — the core builder. Walks the league's full
  `previous_league_id` chain and writes nearly all display JSON (`league.json`,
  `teams.json`, `ledger.json`, `keepers.json`, `playoff_watch.json`,
  `punish_watch.json`, `recap.json`, `trade.json`, `whatif.json`, `meta.json`,
  per-player files…). Loads a ~14 MB players DB; takes a couple of minutes.
- **`ffpros-update.py`** — FantasyPros consensus → `data/ecr.json`. Optional;
  pages degrade gracefully without it (waivers falls back to Sleeper PPR lists,
  trade falls back to lineup-impact-only).
- **`nfl-windows.py`** / **`sleeper-gate.py`** — live-game refresh cadence.
- **`outlook-update.py`** — injury-aware Monte Carlo. Writes
  `projections_<season>.json` (→ Projections page, rebuilt daily) and
  `outlook_<season>.json` (→ draft grades). Must run *after* sleeper-update and
  ffpros-update. Cron daily 9:05am, flock `sc-outlook.lock`.

### The Next app (`web/`)
- Next 15 App Router, `output: "export"`, Tailwind v4, shadcn/ui, lucide.
- `next build` emits a plain folder in `web/out/` that rsyncs exactly like `www/`.
  **No Node runtime on the server, no Vercel.**
- `lib/data.ts` — `fetchJSON`, `DATA_BASE`, and types transcribed from the live
  JSON. **Add types here when you port a page**; the shapes exist only implicitly
  in the vanilla `innerHTML` strings and naming them is most of the value.
- `lib/nav.ts` — the nav model, plus `routePath()`. static-web-server resolves
  `/sleeper/draft`, `/sleeper/draft/` and `/sleeper/draft.html` to the same
  export and every pre-migration bookmark is the `.html` form, so normalise with
  `routePath()` before comparing a pathname against a NAV href.
- `components/gggg/primitives.tsx` — Headshot, PosPill, TeamAvatar, StatCard,
  PageHeader, Note. The Next equivalents of app.js's `headshotHTML`/`posPill`/
  `avatarHTML`. **Reuse these; don't reimplement.**
- `components/gggg/watch.tsx` — shared parts of Playoff/Punish Watch.
- `components/gggg/viz.tsx` — Odometer, PositionalBattle (Matchups) and
  AllTimeBars, ChampionsLedger (League hub). The React port of the old viz.js.
- `components/gggg/league-sections.tsx` — the League hub's shared sections.
- `lib/trade.ts` — Trade Lab's two value lenses and the optimal-lineup solver.

### Two served bundles (both from this one repo)
1. **Main site** (`www/` + `web/out/`) — the owner's personal domain, port 380.
   GGGG lives under `/sleeper`.
2. **FF-only mirror** at **https://gridirongrandgambitgala.xyz** (port 381) — a
   flattened bundle assembled by `ffb/build-ffb.sh`: pages at root, data at
   `/data`, its own icon set + PWA manifest.

**Everything is mount-agnostic** — see §7. Never hardcode a domain or an absolute
`/sleeper/...` path in a page.

---

## 3. Running & testing locally

**Prereqs: Python 3.9+** (builders) **and Node 20+ / npm** (the `web/` app).

> Node is installed user-scope at `C:\Users\spenc\AppData\Local\Programs\nodejs`
> and is on the user PATH. In PowerShell the bare `npx` shim is broken (a known
> npm `.ps1` issue) — use **`npx.cmd`**, or run npx from Git Bash. `node`, `npm`
> and `npm run` work everywhere.

### 3a. Get data locally

The generated data is git-ignored, so a fresh clone has no `data/`. Fastest path
for front-end work is to copy it from the live site:

```bash
mkdir -p www/sleeper/data
for f in league teams meta ledger recap keepers playoff_watch punish_watch \
         draft trade whatif ecr changelog waivers projections_2026; do
  curl -s "https://gridirongrandgambitgala.xyz/data/$f.json" -o "www/sleeper/data/$f.json"
done
```

Or rebuild from the API (needed when you change a builder):

```bash
SC_OUT_DIR=./www/sleeper/data SC_CACHE_DIR=./.sleeper-cache python3 build/sleeper-update.py
```

**Never commit `www/sleeper/data/` — it is git-ignored and rebuilt on the server.**

### 3b. Run the Next app (ported pages)

```bash
cd web && npm install     # first time only
npm run dev               # http://localhost:8390
```

`npm run dev` serves the routes but **not** `data/*.json`. For a realistic run,
build and serve the export next to real data instead:

```bash
cd web && npm run build:site      # emits web/out/ with basePath /sleeper
# assemble a docroot: web/out/* -> <root>/sleeper/, plus your data/ under it
```

### 3c. Two build targets

| script | basePath | data | for |
|---|---|---|---|
| `npm run build:site` | `/sleeper` | `/sleeper/data` | the personal site (port 380/383) |
| `npm run build:ffb` | *(none)* | `/data` | the flattened .xyz bundle (port 381) |

They differ **only** in three env vars. That is the whole cross-bundle story —
see §7.

### 3d. Vanilla pages

```bash
cd www && python3 -m http.server 8000 --bind 0.0.0.0
# http://localhost:8000/sleeper/index.html
```

### 3e. What to verify before pushing
- No console errors.
- The changed flow actually works (click it).
- Desktop **and** mobile (≤ 375px) — the vanilla pages have a bottom tab bar and
  a "More" sheet below 860px; the Next pages use the shadcn sidebar's Sheet.
- No horizontal overflow on mobile.

---

## 4. Caching

**Next assets are content-hashed** (`/_next/static/chunks/<hash>.js`), so a new
build produces new URLs and there is nothing stale to serve. No `?v=N`
bookkeeping — the migration fixed that rather than working around it.

This matters because **Cloudflare fronts the live site and overrides the
origin's `no-cache` for `.js`/`.css`**, giving them a multi-hour browser TTL.
That is what the old `?v=N` rule existed for. HTML is served fresh (not
overridden), which is what lets the hashed asset URLs get picked up — verified
on the .xyz domain after the migration deploy: 12 `_next` assets, zero failed
requests.

The `?v=N` rule now applies to exactly one thing: `assets/legacy/*`, the frozen
copy the NBA section runs off (§8). Those files are deliberately never
rebuilt, so if you ever *do* edit them you must bump `?v=` in the ten
`/nba/*.html` pages by hand.

Root PWA/favicon icons carry a **1-year** TTL with no `?v=` mechanism —
changing them needs a manual Cloudflare purge (owner does this).

## 5. How changes go live

**Direct-push model. You push; the server pulls.**

### Production — ports 380/381, from `main`
`deploy/deploy.sh` on a ~5-minute cron: `git pull`, `py_compile` every
`build/*.py`, then **build the front end twice** before touching any docroot —
`build:site` for `/sleeper` (380) and `build:ffb` for the flattened bundle
(381). Under `set -e` a failed build leaves the previous deploy serving.
Then it rsyncs each export, installs the builders, and restarts the static
servers only if their cache config changed. ~60s end to end.

`export PATH=/usr/local/bin:$PATH` in that script is load-bearing: node lives in
`/usr/local/bin` and cron runs with `PATH=/usr/bin:/bin`, so without it every
deploy fails at `npm ci` with command-not-found.

### Beta — port 383, from `next-phase-1`
`/boot/config/beta-deploy.sh` is a thin wrapper that pulls and `exec`s the
repo-controlled `deploy/beta-deploy.sh`: `npm ci` (only when the lockfile moved)
+ `build:site`, then rsync the export. **Beta has no cron** — it only updates
when someone runs that script over SSH.

### Three deploy gotchas
- **Never `git pull` a deploy clone by hand.** Both scripts compare HEAD before
  and after their own pull and exit early when nothing moved. Pulling manually
  advances HEAD, so the next run sees no change and **never syncs the docroot** —
  the push looks deployed while the site serves old files. Recovery:
  `git reset --hard <previous-commit>` in the clone and let the script pull.
- **`deploy.sh` is self-modifying.** A push that changes it runs the *old*
  in-memory copy on that cron tick. When the change is structural, disable the
  cron, push, then run the new script out-of-band:
  `git show origin/main:deploy/deploy.sh > /tmp/d.sh && bash /tmp/d.sh`.
- **Data is separate.** A new builder field does not exist until the next
  builder run. The front end must degrade gracefully.

## 6. Adding a page

`web/app/<route>/page.tsx`, plus a small `layout.tsx` exporting `metadata` —
client components cannot export it, and without one the page renders with the
bare `GGGG` fallback title. Add the entry to `lib/nav.ts`.

### Rules that bite
- **Query params need `Suspense`.** `useSearchParams()` under `output: "export"`
  must sit inside a `<Suspense>` boundary or the build fails outright. See
  `app/player`, `app/ledger`, `app/projections`, `app/matchups`, `app/team`,
  `app/draft`. The root layout wraps `AppSidebar` for the same reason.
- **`redirect()` is unsupported** under `output: "export"` — there is no server.
- **Do not render a `<main>` in a page.** `SidebarInset` already provides one;
  nesting them is invalid HTML and an ambiguous landmark. Pages use `<div>`.
- **Types go in `lib/data.ts`**, transcribed from the live JSON rather than
  guessed. That file is the record of every shape the builders emit.

## 7. The mount-point model (replaces the old sed hacks)

`ffb/build-ffb.sh` used to patch the `.xyz` bundle into shape by running regexes
over the copied `app.js` and `*.html` — stripping the Sitemap/Home nav links and
swapping the favicon. That only worked while `app.js` shipped as unminified plain
text; against a bundled build every one of those seds would **silently no-op** and
leak `/sitemap.html` onto the FF domain with no error.

Both bundles now derive their differences from one fact — where the bundle is
mounted:

```
SECTION    '/sleeper' | '/nba' | ''   (the dir containing the current page)
DATA_BASE  SECTION + '/data/'
FF_ONLY    SECTION === ''  =>  flattened; no wider site to link out to
```

- **Vanilla side:** an inline `<head>` script publishes `data-section` /
  `data-ff` before first paint; `app.js` falls back to computing `SECTION` from
  `location.pathname` when those attributes are absent (which is what keeps the
  NBA pages working — see §8). CSS hides the footer's `.site-only` spans.
- **Next side:** the same three facts are baked in per bundle by the two npm
  scripts as `NEXT_PUBLIC_BASE_PATH` / `NEXT_PUBLIC_DATA_BASE` /
  `NEXT_PUBLIC_FF_ONLY`.

`build-ffb.sh` now **asserts** the runtime switches shipped and exits non-zero if
any is missing, so a future bundler that drops them fails the build loudly
(messages go to stderr — deploy.sh runs it with `>/dev/null`).

---

## 8. The NBA section — frozen, hands off

There is a separate NBA section at `/nba` on the personal site. Its 10 pages live
**only on the server** (`/mnt/cache/appdata/www-data/nba/`), not in this repo.

They used to share `/assets/app.js` and `/assets/style.css` with GGGG. As of
2026-08-23 they are **decoupled**: a frozen copy of the vanilla assets lives at
`/mnt/cache/appdata/www-data/assets/legacy/` (app.js, style.css, and the brand
font, with the `@font-face` path rewritten to point inside the freeze), and all
10 NBA pages reference `/assets/legacy/*`.

- `deploy.sh` rsyncs `www/assets/` **without** `--delete`, so `legacy/` survives
  deploys and is never refreshed — which is the point.
- **Do not edit or delete `/assets/legacy/`.** It is what lets `/assets/*` be
  cleaned up once the last GGGG vanilla page is ported.
- HTML backups: `/mnt/cache/appdata/nba-html-backup-YYYYMMDD/`.
- This repo is FF-only. Do not add NBA behavior to `web/` or `www/`.

---

## 9. Branches

- **`main`** — deployed to production (~5 min). Do not push until verified.
- **`next-phase-1`** — deploys to beta (383). Merged to `main` on 2026-08-23;
  keep using it as the staging branch.
- `ff-runtime-mount` — the §7 change on its own; merged.
- `sidebar-inset-v2` — a vanilla restyle, superseded by the Next work; unmerged
  and now obsolete.
- `mobile-experimental`, `htmx-boost` — old paused experiments. Leave them.

Only `main` auto-deploys, so branches are safe scratch space. Commit style:
clear subject + body explaining *why*, ending with a `Co-Authored-By:` trailer.

## 10. Conventions

- **Mount-agnostic paths only.** No hardcoded domains; no absolute `/sleeper/...`.
  Use `DATA_BASE`/`fetchJSON` (Next) or the `data/x.json` form (vanilla, resolved
  through `dataURL()`).
- **Vanilla shared helpers** live in `app.js` as globals: `esc`, `avatarHTML`,
  `headshotHTML`, `posPill`, `injuryBadge`, `fmtDate`, `relTime`, `fetchJSON`.
  `esc()` everything you inject as HTML.
- **Next shared UI** lives in `components/gggg/`. Extend it rather than inlining
  a fourth copy of a headshot.
- **Colors are tokens, both sides.** Vanilla: `--bg`, `--surface`, `--border`,
  `--accent`, `--muted`, `--green`/`--red`/`--amber`. Next: the shadcn token
  names in `web/app/globals.css` plus `--ok`/`--warn`/`--bad`/`--info`. Never
  hardcode a hex.
- **`data/` is git-ignored.** Never commit generated JSON.
- **`.gitattributes` forces LF.** The server is Linux; a CRLF shebang breaks the
  builders.
- **`data/changelog.json` is hand-authored on the server** — not in this repo and
  not produced by any builder. You cannot add a changelog entry from a clone; ask
  the owner. Tags that render: `feature`, `improved`, `fix`, `infra`, `docs`.
- **Icons**: FF app-icon set is `ffb/icons/*`; regenerate from
  `app-icon-source.png` with `python ffb/gen-icons.py`.

---

## 11. Known gaps / next steps

- **Three pages have unverified branches.** `recap`, `playoff` and `punish` are
  `{has_data:false}` / `{ready:false}` in production, so only their empty and
  early states have run against real data. The populated branches were verified
  against fixtures derived from the real files. Re-check once the season is
  under way. The same applies to the League hub's **preseason** and **complete**
  modes — in-season is the live one.
- **`www/assets/` is dead weight for GGGG.** Nothing in `web/` uses it. It is
  still synced (without `--delete`) so `assets/legacy/` — the NBA freeze — is
  never disturbed. Deleting the non-legacy files from the docroot is safe but
  was deliberately left as a separate, separately-verified step.
- **`www/warroom/`** is fully standalone (no `app.js`, no `style.css`, port 380
  only, zero `/assets` references). Not part of the migration.
- The League hub's **draft countdown** targets 1:00 PM *wall clock* in
  America/New_York via `zonedTimeToUtc`. That DST correctness is load-bearing;
  do not "simplify" it to a fixed offset.
