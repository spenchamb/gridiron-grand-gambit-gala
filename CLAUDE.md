# CLAUDE.md — agent guide for the GGGG fantasy-football site

You are working on **The Gridiron Grand Gambit Gala (GGGG)** — a fantasy-football
league dashboard. This file is the single source of truth for how the app is
built, how to run and test it locally (including on a phone), and how changes
reach production. Read it fully before making changes. `README.md` covers the
same ground for humans; this file adds the operational detail an agent needs.

**Golden rule: the default branch (`main`) auto-deploys to the live site within
~5 minutes of a push. Never push to `main` until you have run and verified the
change locally.** You cannot deploy or roll back from your machine — deployment
happens on the owner's home server, which you do not have access to. Your only
lever is git; test before you push.

---

## 1. What this app is (scope)

- A **static site**: hand-written HTML pages + one shared `app.js` + one shared
  `style.css`, that fetch JSON data files at runtime. **No framework, no bundler,
  no build step** for the front end. Plain vanilla JS. Keep it that way.
- **Data source is the public Sleeper API only** (`https://api.sleeper.app`, no
  key required). Python builders in `build/` call it and write display-ready JSON.
- The front end never calls Sleeper directly — it only reads the small JSON files
  the builders produce.
- Scope is **fantasy football only**. The same `www/assets/` (`app.js`,
  `style.css`) is also consumed by a separate NBA section on the owner's main
  site, so assets have a `data-sport` switch — but **this repo is FF-only**; do
  not add NBA behavior.

### Pages (`www/sleeper/*.html`)
`index.html` (League home), `matchups.html`, `teams.html`, `team.html`,
`player.html`, `ledger.html` (transaction history), `draft.html`, `keepers.html`,
`playoff.html` (Playoff Watch), `punish.html` (Punish Watch), `whatif.html`,
`trade.html` (Trade Lab), `recap.html` (Last Week), `projections.html`
(Season Projections), `changelog.html`.

Each page is an HTML shell that: loads `app.js` (builds nav + shared helpers),
then runs an inline `<script>` that `fetchJSON('data/…')` and renders. Follow
that pattern for new pages.

---

## 2. Architecture / how it fits together

```
Sleeper API ──> build/*.py (cron on server) ──> data/*.json ──> www/sleeper/*.html + app.js render it
```

- **`build/sleeper-update.py`** — the core builder. Walks the league's full
  `previous_league_id` history chain, resolves players/owners, and writes ALL the
  display JSON (`league.json`, `teams.json`, `team_<owner>.json`, `ledger.json`,
  `draft_*.json`, `keepers.json`, `playoff_watch.json`, `punish_watch.json`,
  `recap.json`, `matchups_*.json`, `trade.json`, `whatif.json`, `meta.json`,
  per-player files, etc.). Loads a ~14 MB players DB into memory — it needs a bit
  of RAM and takes a couple of minutes.
- **`build/ffpros-update.py`** — scrapes FantasyPros consensus rankings, writes
  `data/ecr.json` (optional; pages degrade gracefully without it).
- **`build/nfl-windows.py`** — computes "hot" NFL game windows → `nfl_hot_windows.json`.
- **`build/sleeper-gate.py`** — every-5-min wrapper that runs `sleeper-update`
  only during those hot windows (live-game cadence). Outside windows the 6-hourly
  baseline keeps data fresh.
- **`build/outlook-update.py`** — season projections and draft grades for a
  drafted season. Sets every team's optimal lineup from Sleeper's weekly
  projections and Monte-Carlos the real schedule **with injuries** (per-position,
  per-age weekly hazard; drawn duration; next man up inherits the slot — which is
  what makes bench depth matter and what produces the percentile ranges). Writes
  two files:
    - `projections_<season>.json` → `projections.html` (simulated finish with
      10th–90th percentile win bands, positional strength by lineup slot, top-30
      projected players). **Rebuilt daily** — it tracks trades, waiver adds and
      injury designations all season.
    - `outlook_<season>.json` → `draft.html` (draft grades, steals/reaches
      against keeper-adjusted ADP, fun facts). Draft-specific and static in
      spirit; the draft page links out to Projections for anything live.
  Both pages hide their sections entirely when the file is absent, so it is safe
  to deploy the pages before the builder has ever run. Reads `draft_<season>.json`
  and `ecr.json` out of `SC_OUT_DIR`, so it must run *after* `sleeper-update` and
  `ffpros-update`. Cron: daily 9:05am, flock `sc-outlook.lock`. Knobs:
  `SC_OUTLOOK_SIMS` (default 20000, ~40s), `SC_OUTLOOK_SEED`, `SC_LEAGUE_ID`
  (defaults to `meta.json:current_league_id`).

### Two served bundles (both from this one repo)
1. **Main site** (`www/` served as-is) — the owner's personal domain.
2. **FF-only mirror** at **https://gridirongrandgambitgala.xyz** — a flattened,
   self-contained bundle assembled by **`ffb/build-ffb.sh`** (data at `/data`,
   pages at root, its own icon set + PWA manifest). This is the public GGGG site.

Everything is **domain-agnostic**: pages use **relative paths only** (`data/x.json`,
`/assets/…`). Never hardcode a domain in a page — it's served on more than one.

---

## 3. Running & testing locally (do this before every push)

Prereqs: **Python 3.9+** (the builders use `zoneinfo`). `Pillow` only if you
regenerate icons. No Node, no npm.

### 3a. Get the data onto your device — two ways

**Option A (fast, front-end work): pull live JSON from production.**
The generated data is git-ignored, so a fresh clone has no `data/`. The quickest
way to get real data to develop against is to copy it from the live site:

```bash
mkdir -p www/sleeper/data
# grab the files a page needs (add more as needed):
for f in league teams meta ledger recap keepers playoff_watch punish_watch \
         draft trade whatif ecr; do
  curl -s "https://gridirongrandgambitgala.xyz/data/$f.json" -o "www/sleeper/data/$f.json"
done
# a specific team page also needs its team_<owner>.json and player files:
#   curl -s https://gridirongrandgambitgala.xyz/data/team_<ownerid>.json -o www/sleeper/data/team_<ownerid>.json
```

**Option B (full rebuild, needed when you change a builder): run the builder.**
Every builder path is env-overridable and defaults to the server location, so
this never touches production:

```bash
mkdir -p www/sleeper/data
SC_OUT_DIR=./www/sleeper/data SC_CACHE_DIR=./.sleeper-cache python3 build/sleeper-update.py
# optional consensus rankings:
SC_OUT_DIR=./www/sleeper/data python3 build/ffpros-update.py
```
Env vars (see README for the full table): `SC_OUT_DIR` (where JSON is written),
`SC_CACHE_DIR` (fetch cache), `SC_DOCROOT` (sitemap; skipped locally unless set).
The sitemap step is guarded so a local run can't scan/write outside your project.

**Never commit `www/sleeper/data/` — it's git-ignored and regenerated on the server.**

### 3b. Serve it

```bash
cd www && python3 -m http.server 8000
# open http://localhost:8000/sleeper/index.html
```

### 3c. Test on another device (phone / tablet on the same Wi-Fi)

The mobile nav (bottom tab bar + "More" sheet + top logo bar) only renders at
**viewport < 860px**, so real-device testing matters. Bind the server to all
interfaces and hit your machine's LAN IP from the phone:

```bash
cd www && python3 -m http.server 8000 --bind 0.0.0.0
# find your LAN IP:  Windows: ipconfig   |   macOS/Linux: ipconfig getifaddr en0  /  ip addr
# on the phone (same Wi-Fi):  http://<your-LAN-ip>:8000/sleeper/index.html
```
If the phone can't connect, your OS firewall is likely blocking inbound :8000 —
allow it, or use your editor's built-in preview/port-forwarding. You can also
emulate mobile in desktop devtools (responsive mode, width ≤ 375) for quick checks.

### 3d. What to verify before pushing
- The page loads with **no console errors**.
- The changed flow actually works (click through it).
- Check **both** desktop (≥ 860px) and **mobile** (≤ 375px) — layout, the bottom
  tab bar, and the "More" sheet.
- No horizontal overflow on mobile.

---

## 4. THE CACHE-BUST RULE (read this — it will bite you otherwise)

Cloudflare fronts the live site and **overrides the origin's `no-cache`, serving
`.js` and `.css` with a multi-hour browser cache TTL**. HTML is served fresh
(no-cache), but assets are not. Therefore:

**Any change to `www/assets/app.js` or `www/assets/style.css` will NOT reach
users until you bump the `?v=N` query string on the asset references in every
`www/sleeper/*.html`.** Do this in the same commit:

```bash
cd www/sleeper
# bump BOTH numbers to the next integer, matching whatever they currently are:
sed -i 's/app\.js?v=31/app.js?v=32/g;   s/style\.css?v=29/style.css?v=30/g' *.html
grep -h "app.js?v=\|style.css?v=" *.html | sort | uniq -c   # verify all 15 pages match
```
(Check the current numbers first — grep for `app.js?v=` — and increment from there.)

- Editing **only** an HTML page's inline `<script>`? No bump needed — HTML is served fresh.
- The root PWA/favicon icons (`/favicon*`, `/apple-touch-icon.png`, `/icon-*.png`)
  carry a **1-year** TTL and have **no** `?v=` mechanism — changing them requires a
  **manual Cloudflare cache purge** (owner does this in the Cloudflare dashboard).

---

## 5. How changes go live (deploy model)

**Direct-push model. You do not run the deploy — you push, the server pulls.**

- The owner's home server runs `deploy/deploy.sh` on a **~5-minute cron**. When it
  sees new commits on `main` it: `git pull`, **`py_compile`-checks every
  `build/*.py`** (a builder that doesn't compile is never deployed), `rsync`s
  `www/sleeper` → docroot and `www/assets` → docroot, installs the builders,
  rebuilds the FF bundle (`ffb/build-ffb.sh`), and restarts the static servers
  only if their cache config changed.
- So a **front-end change** (HTML/CSS/JS) is live **~5 min** after a push to `main`.
- **Data is separate.** `sleeper-update.py` runs on its own schedule (every ~6h,
  plus every 5 min during live games). If your change adds a **new field or file
  to a builder**, that data won't exist on the live site until the next builder
  run. The front end must **degrade gracefully** when a field/file is missing
  (wrap optional `fetchJSON` in try/catch, guard on `undefined`), or the page will
  break in the window between your front-end deploy and the next data build.
- `deploy.sh` is **self-modifying**: a push that changes `deploy.sh` itself only
  fully takes effect on the *next* cron run (the current run executes the old
  in-memory copy). If a change relies on new deploy.sh behavior, push a trivial
  follow-up commit to trigger a clean run.

---

## 6. Branching workflow

- **`main`** is the deployed branch. Merging/pushing to it ships to production in ~5 min.
- **Do feature work on a branch**, verify locally (§3), then merge to `main` when it works:
  ```bash
  git checkout -b my-feature
  # …edit, run locally, test on a device…
  git checkout main && git merge my-feature   # or open a PR if you prefer
  git push origin main
  ```
- You may push a **feature branch** to GitHub freely to share/back it up — only
  `main` auto-deploys, so branches are safe scratch space.
- Existing branches: `mobile-experimental` (a paused, experimental vanilla-SPA
  rewrite — not merged), `htmx-boost` (old experiment). Leave them unless asked.
- Commit style: clear subject + body explaining *why*. End commit messages with a
  `Co-Authored-By:` trailer for the agent.

---

## 7. Conventions & things that will trip you up

- **Relative paths only** in pages (served on multiple domains). No hardcoded URLs.
- **Shared helpers** live in `app.js` and are exposed as globals: `esc`,
  `avatarHTML`, `headshotHTML`, `posPill`, `injuryBadge`, `fmtDate`, `relTime`,
  `fetchJSON`. Reuse them; don't reimplement. `esc()` all user/data strings you
  inject as HTML.
- **Nav is built by `app.js`** for every page — desktop sidebar + mobile bottom
  tab bar + "More" sheet. Add a new page to the nav there (both `buildSidebar`
  and `buildTabbar`). A page declares itself via `<body data-page="…">`.
- **CSS is variable-driven** (dark football palette). Key vars in `style.css`
  `:root`: `--bg`, `--surface`/`--surface2`, `--border`, `--text`, `--accent`/
  `--accent-dim`, `--muted`, `--green`/`--red`/`--amber`, `--radius` (0 — sharp
  corners by design), `--font-mono` (Axis Extrabold). Use them; don't hardcode colors.
- **`data/` is git-ignored** — never commit generated JSON. `secrets.env`/`.env`
  are git-ignored and server-only (the app needs no secrets — public API).
- **`.gitattributes` forces LF.** The server is Linux; a CRLF shebang breaks the
  builders. Don't reintroduce CRLF.
- **`ffb/build-ffb.sh`** flattens the FF bundle and, notably, **repoints the
  favicon** and **strips the sitemap link**. If you add cross-site references or
  absolute paths, you'll break the FF mirror — keep pages self-contained.
- **Icons**: the FF app-icon set is `ffb/icons/*`; regenerate from
  `ffb/icons/app-icon-source.png` with `python ffb/gen-icons.py`. Originals are
  kept in `ffb/icons/original/`.
- **Changelog**: `data/changelog.json` is **hand-authored on the server** (not in
  this repo, not produced by any builder; the FF bundle shares it via a bind
  mount). You can't add a changelog entry from a clone — ask the owner. Tags that
  render: `feature`, `fix`, `infra`, `docs`.

---

## 8. Quick reference — a typical change, start to finish

1. `git checkout -b my-change`
2. Get data locally (§3a, Option A is fastest for front-end work).
3. Edit `www/…`. If you touched `app.js` or `style.css`, **bump `?v=`** (§4).
4. `cd www && python3 -m http.server 8000 --bind 0.0.0.0` — verify on desktop and
   a phone (§3c), no console errors.
5. Commit, merge to `main`, `git push origin main`.
6. Live in ~5 min. If you added a builder field, remember the data appears only on
   the next server build — confirm the front end degrades gracefully until then.
