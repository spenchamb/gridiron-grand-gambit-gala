# The Gridiron Grand Gambit Gala

Source for the GGGG fantasy-football dashboards. The live site is generated
from the [Sleeper](https://sleeper.com) API by the builders in `build/` and
served as static files from a home server (Unraid, Intel N100).

- **Live site:** https://gridirongrandgambitgala.xyz

## Status: mid-migration

The front end is moving from hand-written vanilla pages to a **Next.js static
export**, one page at a time. Both stacks run side by side — `static-web-server`
serves whichever file exists, so a half-ported site works.

| | stack | source | pages |
|---|---|---|---|
| 12 | Next.js static export | `web/` | teams, changelog, keepers, recap, player, waivers, ledger, playoff, punish, whatif, projections, trade |
| 4 | vanilla HTML + `app.js` | `www/sleeper/` | index, draft, team, matchups |

The migration lives on **`next-phase-1`** and deploys to beta (port 383).
**`main` is still vanilla-only** — production has not received the Next build yet.

Nothing about the data pipeline changed: both stacks fetch `data/*.json` in the
browser at runtime, because the builders rewrite that JSON on cron (every 5 min
to 6 h) and build-time data would mean rebuilding the site on every tick.

## Repo layout

```
build/            Python builders (run on the server via cron)
  sleeper-update.py     Core build: walks the league history chain, writes display JSON
  ffpros-update.py      Expert-consensus rankings (writes sleeper/data/ecr.json)
  nfl-windows.py        Computes NFL game windows for the game-aware refresh cadence
  sleeper-gate.py       Runs sleeper-update only during live game windows
  warroom-update.py     Draft-day consensus board (writes warroom/data/board.json)
  outlook-update.py     Injury-aware season simulation: writes
                        projections_<season>.json (Projections page, rebuilt daily)
                        and outlook_<season>.json (draft grades + facts)

web/              Next.js app — the ported pages (static export, no server runtime)
  app/<route>/          One directory per page
  lib/data.ts           fetchJSON + types transcribed from the live JSON
  lib/nav.ts            Nav model; each entry declares ported: true|false
  components/gggg/      Shared display primitives + Playoff/Punish internals
  next.config.ts        output: "export"; basePath from env

www/              Hand-edited docroot source
  sleeper/*.html        The 4 not-yet-ported pages (fetch data/*.json at runtime)
  assets/               Shared style.css + app.js for those pages
  warroom/              Standalone Draft War Room (not part of the migration)

ffb/              FF-only mirror for gridirongrandgambitgala.xyz
  build-ffb.sh          Assembles a flattened, self-contained bundle
  sws-config.toml       Cache headers for the FF bundle's static-web-server
deploy/
  deploy.sh             Production pull-and-deploy (cron)
  beta-deploy.sh        Beta: builds the Next export and overlays it on the vanilla pages
sws/config.toml   Reference: main site's static-web-server cache config
```

## How changes go live

Direct-push model. Push to the default branch; the server pulls on a short cron
(`deploy/deploy.sh`, flock'd) and — only when there are new commits — syncs the
source into place, compile-checks the builders, and rebuilds the FF bundle.

Beta (port 383) tracks `next-phase-1` and additionally runs `npm ci` +
`npm run build:site`, then lays `web/out/` over the vanilla pages. **Beta has no
cron** — it updates only when `bash /boot/config/beta-deploy.sh` is run manually.

Generated `data/*.json` is **not** in git; the builders write it on the server on
their own schedule.

> **Never `git pull` a deploy clone by hand.** Both deploy scripts compare HEAD
> before and after their own pull and exit early when nothing moved. Pulling
> manually advances HEAD, so the next run sees no change and never syncs the
> docroot — the push looks deployed while the site serves old files.

## Two served bundles, one repo

1. **Main site** (port 380) — GGGG under `/sleeper`, plus a separate NBA section.
2. **FF-only mirror** (port 381, the `.xyz` domain) — flattened: pages at root,
   data at `/data`, its own icons and PWA manifest.

They differ only in **where the bundle is mounted**, expressed as three facts:

```
SECTION    '/sleeper' | '/nba' | ''   (the dir containing the current page)
DATA_BASE  SECTION + '/data/'
FF_ONLY    SECTION === ''  =>  flattened; no wider site to link out to
```

The vanilla side derives these at runtime (an inline `<head>` script, with a
`location.pathname` fallback); the Next side bakes them in per bundle via
`NEXT_PUBLIC_BASE_PATH` / `NEXT_PUBLIC_DATA_BASE` / `NEXT_PUBLIC_FF_ONLY`. Never
hardcode a domain or an absolute `/sleeper/...` path.

## Secrets

No credentials live in this repo. The builders only call the public Sleeper API,
which needs no key. `.gitignore` blocks `secrets.env`, `.env`, and `data/`.

## Local development

**Prereqs:** Python 3.9+ (builders) and Node 20+ / npm (the `web/` app).

### Get data

The generated data is git-ignored, so a fresh clone has none. Fastest path for
front-end work is to copy it from the live site:

```bash
mkdir -p www/sleeper/data
for f in league teams meta ledger recap keepers playoff_watch punish_watch \
         draft trade whatif ecr changelog waivers projections_2026; do
  curl -s "https://gridirongrandgambitgala.xyz/data/$f.json" -o "www/sleeper/data/$f.json"
done
```

Or rebuild from the API. Every builder path is env-overridable and defaults to
the server location, so a local run never touches production:

```bash
SC_OUT_DIR=./www/sleeper/data SC_CACHE_DIR=./.sleeper-cache python3 build/sleeper-update.py
SC_OUT_DIR=./www/sleeper/data python3 build/ffpros-update.py   # optional consensus ranks
```

| Env var           | Overrides                        | Default |
|-------------------|----------------------------------|---------|
| `SC_OUT_DIR`      | where builders write JSON        | `/mnt/cache/appdata/www-data/sleeper/data` |
| `SC_CACHE_DIR`    | sleeper-update's fetch cache     | `/mnt/cache/appdata/sleeper-cache` |
| `SC_DOCROOT`      | docroot for sitemap generation   | derived from `SC_OUT_DIR` (skipped locally unless set) |
| `SC_WINDOWS_FILE` | nfl-windows output / gate input  | `/boot/config/nfl_hot_windows.json` |
| `SC_BUILD_SCRIPT` | build script the gate runs       | `/boot/config/sleeper-update.py` |
| `SC_LOG_FILE`     | gate's log file                  | `/var/log/sleeper-update.log` |
| `SC_OUTLOOK_SIMS` | outlook-update simulation count  | `20000` |

### Run the ported pages

```bash
cd web && npm install    # first time
npm run dev              # http://localhost:8390
```

`npm run dev` serves the routes but not `data/*.json`. For a realistic run, build
the export and serve it next to real data:

| script | basePath | data | for |
|---|---|---|---|
| `npm run build:site` | `/sleeper` | `/sleeper/data` | personal site (380/383) |
| `npm run build:ffb` | *(none)* | `/data` | flattened `.xyz` bundle (381) |

### Run the vanilla pages

```bash
cd www && python3 -m http.server 8000 --bind 0.0.0.0
# http://localhost:8000/sleeper/index.html
```

Bind to `0.0.0.0` and hit your LAN IP from a phone — the vanilla mobile nav
(bottom tab bar + "More" sheet) only renders below 860px.

### Before pushing

No console errors; the changed flow actually works; check desktop **and** mobile
(≤ 375px); no horizontal overflow.

Changing `www/assets/app.js` or `style.css` also requires bumping `?v=N` on the
references in the remaining `www/sleeper/*.html` — Cloudflare overrides the
origin's `no-cache` for `.js`/`.css`. Next assets are content-hashed and need no
such bookkeeping.
