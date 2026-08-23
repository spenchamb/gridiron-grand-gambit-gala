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

## 0. Read this first — the app is mid-migration

The front end is being moved from hand-written vanilla pages to a **Next.js
static export**, one page at a time. **Both stacks are live simultaneously** and
that is by design, not a broken intermediate state.

| | stack | source | status |
|---|---|---|---|
| 12 pages | Next.js static export | `web/` | ported |
| 4 pages | vanilla HTML + `app.js` | `www/sleeper/` | not yet ported |

- **Ported:** teams, changelog, keepers, recap, player, waivers, ledger, playoff,
  punish, whatif, projections, trade
- **Still vanilla:** `index.html`, `draft.html`, `team.html`, `matchups.html`

`static-web-server` serves whichever file exists, so a half-ported site works.
The migration lives on **`next-phase-1`**, which deploys to **beta (port 383)**.
**`main` is still vanilla-only** — production has not received the Next build yet.

**Do not "restore consistency" by converting things back to vanilla.** If you are
adding a page or changing shared UI, it goes in `web/` unless it touches one of
the four pages listed above.

---

## 1. What this app is (scope)

- **Data source is the public Sleeper API only** (`https://api.sleeper.app`, no
  key). Python builders in `build/` call it and write display-ready JSON.
- The front end never calls Sleeper directly — it reads the JSON the builders
  produce, **at runtime, in the browser**. This is true of both stacks and is a
  deliberate constraint: the builders rewrite `data/*.json` on cron (every 5 min
  to 6 h), so build-time data would mean rebuilding the site on every tick.
- Scope is **fantasy football only**. See §8 for the NBA section, which now has
  its own frozen copy of the vanilla assets and must not be dragged along.

---

## 2. Architecture

```
Sleeper API ──> build/*.py (cron on server) ──> data/*.json
                                                    │
                          ┌─────────────────────────┴──────────────────────┐
                          ▼                                                ▼
              web/ (Next.js, 12 routes)                www/sleeper/*.html (4 pages)
              next build --> web/out/                  served as-is, render via app.js
                          └──────────── both fetch data/*.json in the browser ────────┘
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
- `lib/nav.ts` — the nav model. Each entry declares `ported: true|false` (see §6).
- `components/gggg/primitives.tsx` — Headshot, PosPill, TeamAvatar, StatCard,
  PageHeader, Note. The Next equivalents of app.js's `headshotHTML`/`posPill`/
  `avatarHTML`. **Reuse these; don't reimplement.**
- `components/gggg/watch.tsx` — shared parts of Playoff/Punish Watch.
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

**Vanilla assets — the `?v=N` rule still applies.** Cloudflare fronts the live
site and **overrides the origin's `no-cache`, serving `.js`/`.css` with a
multi-hour browser TTL**. So any change to `www/assets/app.js` or
`www/assets/style.css` must bump `?v=N` on the references in the remaining
`www/sleeper/*.html` in the same commit:

```bash
cd www/sleeper
grep -h "app.js?v=\|style.css?v=" *.html | sort | uniq -c   # check current, then bump
```

**Next assets are immune** — `next build` emits content-hashed filenames
(`/_next/static/chunks/<hash>.js`), so a new build produces new URLs and there is
nothing stale to serve. No `?v=` bookkeeping. This is one of the things the
migration fixes rather than works around.

**HTML is served fresh** (`no-cache` at origin, not overridden), which is what
lets the hashed asset URLs get picked up. Verify this on the first prod deploy of
the Next bundle.

Root PWA/favicon icons carry a **1-year** TTL with no `?v=` mechanism — changing
them needs a manual Cloudflare purge (owner does this).

---

## 5. How changes go live

**Direct-push model. You push; the server pulls.**

### Production — port 380/381, from `main`
`deploy/deploy.sh` on a ~5-minute cron: `git pull`, `py_compile` every
`build/*.py`, rsync `www/sleeper` + `www/assets` + `www/warroom` → docroot,
install builders, rebuild the FF bundle, restart static servers only if their
cache config changed.

**`deploy.sh` does not build the Next app yet.** Production is vanilla-only until
`next-phase-1` merges, at which point deploy.sh needs the same
`npm ci && npm run build:site` + overlay-rsync steps that `deploy/beta-deploy.sh`
already has.

### Beta — port 383, from `next-phase-1`
`/boot/config/beta-deploy.sh` is a **thin wrapper** that pulls and `exec`s the
repo-controlled `deploy/beta-deploy.sh`, which:
1. `npm ci` (skipped unless the lockfile moved) and `npm run build:site`,
2. rsyncs `www/sleeper/` **with** `--delete`,
3. lays `web/out/` over the top **without** `--delete`.

That ordering is the whole trick — a route present in both stacks resolves to the
Next one. The build runs **before** anything touches the docroot, so under
`set -e` a failed build leaves the previous deploy serving.

**Beta has no cron.** It only updates when someone runs
`bash /boot/config/beta-deploy.sh` over SSH.

### Two deploy gotchas
- **Never `git pull` a deploy clone by hand.** Both scripts compare HEAD before
  and after their own pull and exit early when nothing moved. Pulling manually
  advances HEAD, so the next run sees no change and **never syncs the docroot** —
  the push looks deployed while the site serves old files. Recovery:
  `git reset --hard <previous-commit>` in the clone and let the script pull.
- **Data is separate.** If your change needs a new builder field, it won't exist
  until the next builder run. The front end must degrade gracefully.

---

## 6. Porting a page (the Phase 2 loop)

One commit per page:

1. Read the vanilla page's inline `<script>`; transcribe its JSON shape into
   `web/lib/data.ts` as real types.
2. Add `web/app/<route>/page.tsx` (+ a tiny `layout.tsx` exporting `metadata` —
   client components cannot export it, and without it the page renders with the
   bare `GGGG` fallback title).
3. Flip `ported: true` in `web/lib/nav.ts`.
4. `git rm www/sleeper/<page>.html`.

### Rules that bite
- **Never add a root `app/page.tsx` until `index.html` is ported.** A root route
  exports as `out/index.html`, which is the live league hub — the overlay rsync
  would silently clobber it. `index.html` is the last page to port.
- **Add the route and delete the `.html` in the same commit.** Leaving both means
  the export wins and the vanilla page becomes present-but-unreachable.
- **Cross-stack links.** A link to a *not-yet-ported* page must be a plain `<a>`
  to its `.html` (with `legacyHref()` to apply basePath). A `next/link` would
  route to a page that does not exist. Current live examples: keepers → team,
  player → matchups, projections → team.
- **Query params need `Suspense`.** `useSearchParams()` under `output: "export"`
  must sit inside a `<Suspense>` boundary or the build fails outright. See
  `app/player`, `app/ledger`, `app/projections`.
- `redirect()` is unsupported under `output: "export"` — there is no server.

---

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

- **`main`** — deployed to production (~5 min). Vanilla front end + the §7 mount
  model. Do not push until verified.
- **`next-phase-1`** — the React migration; deploys to beta (383). Active branch.
- **`ff-runtime-mount`** — the §7 change on its own; merged to `main`.
- **`sidebar-inset-v2`** — a vanilla restyle (oklch tokens, inset shell,
  collapsible rail) built on `ff-runtime-mount`. Superseded in spirit by the Next
  work; not merged.
- `mobile-experimental`, `htmx-boost` — old paused experiments. Leave them.

Only `main` auto-deploys, so branches are safe scratch space. Commit style: clear
subject + body explaining *why*, ending with a `Co-Authored-By:` trailer.

---

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

- **4 pages left to port:** matchups, team, draft, then index last.
  - `team.html` sets a per-manager accent via inline style — needs rethinking as
    a token override.
  - `draft.html` shares big-board logic with the War Room, which stays vanilla.
    Open call: duplicate the logic or leave draft for last.
- **`deploy.sh` must learn to build** before `next-phase-1` merges to `main`
  (§5).
- **Three pages have unverified branches.** `recap`, `playoff` and `punish` are
  currently `{has_data:false}` / `{ready:false}` in production, so only their
  empty/early states have been seen against real data. The populated branches
  were verified against fixtures. Re-check once the season is under way.
- **The Next sidebar is flat.** The vanilla sidebar had Teams/Draft/What-If
  submenus; `web/components/app-sidebar.tsx` does not yet. What-If keeps its
  `#sec-*` anchors so those deep links still work when the submenu returns.
- **`www/warroom/`** is fully standalone (no `app.js`, no `style.css`, port 380
  only). It is not part of the migration and has no reason to move.
