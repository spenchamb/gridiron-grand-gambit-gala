# The Gridiron Grand Gambit Gala

Source for the GGGG fantasy-football dashboards. The live site is generated
from the [Sleeper](https://sleeper.com) API by the builders in `build/` and
served as static files from a home server (Unraid, Intel N100).

- **Live site:** https://gridirongrandgambitgala.xyz

## Repo layout

```
build/            Python builders (run on the server via cron)
  sleeper-update.py     Core build: walks the league history chain, writes display JSON
  ffpros-update.py      Expert-consensus rankings producer (writes sleeper/data/ecr.json)
  nfl-windows.py        Computes NFL game windows for the game-aware refresh cadence
  sleeper-gate.py       Runs sleeper-update only during live game windows
  warroom-update.py     Draft-day consensus board (writes warroom/data/board.json)
  outlook-update.py     Injury-aware season simulation: writes
                        sleeper/data/projections_<season>.json (drives projections.html,
                        rebuilt daily) and outlook_<season>.json (draft grades + facts
                        on draft.html)
www/              Hand-edited docroot source (deployed to the live site)
  sleeper/*.html        The dashboard pages (client-side; fetch data/*.json at runtime)
  assets/               Shared style.css + app.js (also used by the NBA section)
ffb/              FF-only mirror for gridirongrandgambitgala.xyz
  build-ffb.sh          Assembles a flattened, self-contained bundle (no cross-site refs)
  sws-config.toml       Cache headers for the FF bundle's static-web-server
deploy/deploy.sh  Server pull-and-deploy (cron); syncs source into place, rebuilds bundle
sws/config.toml   Reference: main site's static-web-server cache config
```

## How changes go live

Direct-push model. Push to the default branch; the server pulls on a short cron
(`deploy/deploy.sh`, flock'd) and — only when there are new commits — syncs the
source into place, recompiles-checks the builders, and rebuilds the FF bundle.
Generated `data/*.json` is **not** in git; the builders write it on the server on
their own schedule.

## Secrets

No credentials live in this repo. The builders only call the public Sleeper API,
which needs no key. Never commit secrets — `.gitignore` blocks `secrets.env`,
`.env`, and `data/`.

## Local development

The builders read the Sleeper API (public, no key) and write JSON. You can run
them on your own machine without the server — just point their output at a local
directory via environment variables. Every path defaults to the server location,
so nothing here changes production behavior.

| Env var           | Overrides                        | Default |
|-------------------|----------------------------------|---------|
| `SC_OUT_DIR`      | where builders write JSON        | `/mnt/cache/appdata/www-data/sleeper/data` |
| `SC_CACHE_DIR`    | sleeper-update's fetch cache     | `/mnt/cache/appdata/sleeper-cache` |
| `SC_DOCROOT`      | docroot for sitemap generation   | derived from `SC_OUT_DIR` (sitemap is skipped locally unless set) |
| `SC_WINDOWS_FILE` | nfl-windows output / gate input  | `/boot/config/nfl_hot_windows.json` |
| `SC_BUILD_SCRIPT` | build script the gate runs       | `/boot/config/sleeper-update.py` |
| `SC_LOG_FILE`     | gate's log file                  | `/var/log/sleeper-update.log` |

Example — build the full site data into a local `./data` folder and preview it:

```bash
mkdir -p data
SC_OUT_DIR=./data SC_CACHE_DIR=./.cache python3 build/sleeper-update.py
# optional: expert-consensus rankings and the FF-only mirror bundle
SC_OUT_DIR=./data python3 build/ffpros-update.py
# serve www/ + your ./data locally with any static server, e.g.:
#   (cd www && python3 -m http.server 8000)  then open /sleeper/
```

Edit HTML/CSS/JS in `www/`; the pages fetch `data/*.json` at runtime, so once
you've built data locally you can iterate on the front end with no server access.
Push to `main` and the live site updates within ~5 minutes.
