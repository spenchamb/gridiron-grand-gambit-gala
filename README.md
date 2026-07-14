# The Gridiron Grand Gambit Gala

Source for the GGGG fantasy-football dashboards. The live site is generated
from the [Sleeper](https://sleeper.com) API by the builders in `build/` and
served as static files from a home server (Unraid, Intel N100).

- **Primary:** https://scbl.ink/sleeper/
- **League mirror (FF-only):** https://gridirongrandgambitgala.com

## Repo layout

```
build/            Python builders (run on the server via cron)
  sleeper-update.py     Core build: walks the league history chain, writes display JSON
  ffpros-update.py      Expert-consensus rankings producer (writes sleeper/data/ecr.json)
  nfl-windows.py        Computes NFL game windows for the game-aware refresh cadence
  sleeper-gate.py       Runs sleeper-update only during live game windows
  sc-changelog-notify.py  Emails a summary when the changelog is updated
www/              Hand-edited docroot source (deployed to the live site)
  sleeper/*.html        The dashboard pages (client-side; fetch data/*.json at runtime)
  assets/               Shared style.css + app.js (also used by the NBA section)
ffb/              FF-only mirror for gridirongrandgambitgala.com
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

No credentials live in this repo. The changelog emailer reads `GMAIL_USER` /
`GMAIL_PASS` from the environment or a git-ignored `secrets.env`
(`/boot/config/secrets.env` on the server; override with `$SECRETS_ENV`). Never
commit secrets — `.gitignore` blocks `secrets.env`, `.env`, and `data/`.

## Local development

The builders currently use server-absolute paths (e.g. `OUT_DIR`,
`/boot/config/secrets.env`). To run one against a scratch output dir you can
edit those constants at the top of the script. Making them fully
environment-overridable for off-server testing is a planned improvement.
