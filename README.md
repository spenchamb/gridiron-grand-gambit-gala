# The Gridiron Grand Gambit Gala

Source for the GGGG fantasy-football dashboards. The live site is generated
from the [Sleeper](https://sleeper.com) API by the builders in `build/` and
served as static files from a home server (Unraid, Intel N100).

- **Live site:** https://gridirongrandgambitgala.xyz

## Status

The front end is a **Next.js static export**. All 16 pages are Next routes;
`www/sleeper/` holds only the gitignored `data/` directory. Live in production
since 2026-08-23.

Both bundles come from the same `web/` source, compiled twice because the base
path is baked into every asset URL:

| | port | mount | build |
|---|---|---|---|
| personal site | 380 | GGGG under `/sleeper` | `npm run build:site` |
| `.xyz` FF mirror | 381 | flattened at `/` | `npm run build:ffb` |
| beta | 383 | `/sleeper` | `build:site`, from `next-phase-1` |

The data pipeline is unchanged: both bundles fetch `data/*.json` in the browser
at runtime, because the builders rewrite that JSON on cron (every 5 min to 6 h)
and build-time data would mean rebuilding the site on every tick.

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

web/              The site — Next.js static export, no server runtime
  app/<route>/          One directory per page (16 routes)
  lib/data.ts           fetchJSON + types transcribed from the live JSON
  lib/nav.ts            Nav model and routePath()
  lib/trade.ts          Trade Lab's value lenses + optimal-lineup solver
  components/gggg/      Shared primitives, charts, watch and league-hub sections
  next.config.ts        output: "export"; basePath from env

www/              Non-GGGG docroot source
  assets/               Legacy vanilla assets; kept only so the server-side
                        assets/legacy freeze (used by /nba) is never disturbed
  warroom/              Standalone Draft War Room — not part of the app
  sleeper/data/         Generated JSON (gitignored)

ffb/              FF-only mirror for gridirongrandgambitgala.xyz
  build-ffb.sh          Lays the no-basePath export into www-ffb + icons/manifest
  sws-config.toml       Cache headers for the FF bundle's static-web-server
deploy/
  deploy.sh             Production: builds both bundles, then rsyncs (cron)
  beta-deploy.sh        Beta: builds the site bundle and rsyncs it
sws/config.toml   Reference: main site's static-web-server cache config
```

## How changes go live

Direct-push model. Push to the default branch; the server pulls on a short cron
(`deploy/deploy.sh`, flock'd) and — only when there are new commits — syncs the
source into place, compile-checks the builders, and rebuilds the FF bundle.

`deploy.sh` builds the front end **twice** — `build:site` and `build:ffb` —
before touching either docroot, so under `set -e` a failed build leaves the
previous deploy serving. ~60s end to end.

Beta (port 383) tracks `next-phase-1` and runs the same build for `/sleeper`
only. **Beta has no cron** — it updates only when
`bash /boot/config/beta-deploy.sh` is run manually.

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

Next assets are content-hashed, so there is no `?v=N` bookkeeping — a new build
produces new URLs. That matters because Cloudflare overrides the origin's
`no-cache` for `.js`/`.css`; HTML is served fresh, which is what lets the hashed
URLs get picked up.
