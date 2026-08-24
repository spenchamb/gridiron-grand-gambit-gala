#!/bin/bash
# Server-side deploy for the GGGG fantasy site.
# Runs on cron (flock'd). Pulls the repo; if new commits arrived, syncs the
# source into place and rebuilds the FF-only bundle. Direct-push model: whatever
# is on the default branch goes live on the next pull.
#
# Layout on the server:
#   clone      : /mnt/cache/appdata/ffb-src   (this repo)
#   main docroot: /mnt/cache/appdata/www-data (the sleeper section + shared assets)
#   builders    : /boot/config/*.py
#   FF bundle   : built by ffb/build-ffb.sh into /mnt/cache/appdata/www-ffb (port 381)
#
# The front end is a Next.js static export (web/). It is compiled TWICE — once
# with basePath=/sleeper for this docroot, once with no basePath for the
# flattened FF bundle — because the base path is baked into every asset URL and
# the two mounts differ. Both builds run before anything touches a docroot, so
# under `set -e` a failed build leaves the previous deploy serving.
set -euo pipefail

REPO=/mnt/cache/appdata/ffb-src
DOCROOT=/mnt/cache/appdata/www-data
cd "$REPO"

before=$(git rev-parse HEAD)
git pull --ff-only -q
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ]; then
  exit 0   # nothing new — do not churn the site
fi
echo "deploy: $before -> $after"

# Safety gate: never deploy a builder that doesn't even compile.
python3 -m py_compile "$REPO"/build/*.py

# 0) Build the front end. npm ci only when the lockfile actually moved — it is
#    slow and almost never the thing that changed.
export PATH="/usr/local/bin:$PATH"
cd "$REPO/web"
if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.package-lock-stamp 2>/dev/null; then
  echo "deploy: npm ci"
  npm ci --no-audit --no-fund
  cp package-lock.json node_modules/.package-lock-stamp
fi
echo "deploy: next build (site)"
npm run build:site
rm -rf "$REPO/web/out-site" && cp -r "$REPO/web/out" "$REPO/web/out-site"
echo "deploy: next build (ffb)"
npm run build:ffb
rm -rf "$REPO/web/out-ffb" && cp -r "$REPO/web/out" "$REPO/web/out-ffb"
cd "$REPO"

# 1) Site export -> docroot/sleeper (never touch generated data/ or legacy _old/)
rsync -a --delete \
  --exclude='data' --exclude='data/**' --exclude='_old' --exclude='_old/**' \
  "$REPO/web/out-site/" "$DOCROOT/sleeper/"

# 2) Shared assets. GGGG no longer uses these — the NBA section runs off its
#    own frozen copy at assets/legacy/ — but this syncs without --delete so
#    that freeze survives untouched.
rsync -a "$REPO/www/assets/" "$DOCROOT/assets/"

# 2b) Draft War Room — standalone section, shares no assets or data with the
#     fantasy pages, so it syncs on its own and keeps its own generated data/.
rsync -a --exclude='data' --exclude='data/**' "$REPO/www/warroom/" "$DOCROOT/warroom/"

# 3) Builders + FF build tooling into their runtime locations
for f in sleeper-update ffpros-update ffpros-api ffpros-gate nfl-windows sleeper-gate warroom-update outlook-update; do
  install -m 700 "$REPO/build/$f.py" "/boot/config/$f.py"
done
install -m 755 "$REPO/ffb/build-ffb.sh" /boot/config/build-ffb.sh
mkdir -p /mnt/cache/appdata/sws-ffb
old_sws_hash=$(md5sum /mnt/cache/appdata/sws/config.toml 2>/dev/null | cut -d' ' -f1 || true)
old_swsffb_hash=$(md5sum /mnt/cache/appdata/sws-ffb/config.toml 2>/dev/null | cut -d' ' -f1 || true)
install -m 644 "$REPO/sws/config.toml" /mnt/cache/appdata/sws/config.toml
install -m 644 "$REPO/ffb/sws-config.toml" /mnt/cache/appdata/sws-ffb/config.toml

# 4) Rebuild the FF-only bundle from the no-basePath export. build-ffb.sh
#    asserts the basePath flavour and that the data/ mountpoint survives —
#    a mismatch is silent at build time and 404s every asset at runtime.
bash /boot/config/build-ffb.sh "$REPO/web/out-ffb" >/dev/null

# 5) static-web-server only reads its config.toml at startup — restart the
#    container whenever that file actually changed so cache-header edits apply.
new_sws_hash=$(md5sum /mnt/cache/appdata/sws/config.toml | cut -d' ' -f1)
new_swsffb_hash=$(md5sum /mnt/cache/appdata/sws-ffb/config.toml | cut -d' ' -f1)
if [ "$old_sws_hash" != "$new_sws_hash" ]; then
  docker restart static-web >/dev/null
  echo "deploy: restarted static-web (config changed)"
fi
if [ "$old_swsffb_hash" != "$new_swsffb_hash" ]; then
  docker restart static-web-ffb >/dev/null
  echo "deploy: restarted static-web-ffb (config changed)"
fi

# 6) Run any data builder whose source changed in this pull right now, instead
#    of waiting for its own cron slot (up to 6h for sleeper-update, 3h for
#    warroom-update, a full day for ffpros-update). Same env/lock as its
#    crontab entry, so a scheduled run landing at the same moment just no-ops
#    (flock -n) rather than racing this one. `|| true` (via the echo) so a
#    builder failure here doesn't fail the deploy — the site is already live,
#    the data just stays one run stale, same as if this had never fired.
changed=$(git diff --name-only "$before" "$after" -- build/)

if echo "$changed" | grep -q '^build/sleeper-update\.py$'; then
  echo "deploy: running sleeper-update.py now (source changed)"
  flock -n /tmp/sc-fb.lock env SITE_BRAND=scbl.ink /usr/bin/python3 /boot/config/sleeper-update.py \
    >>/var/log/sleeper-update.log 2>&1 || echo "deploy: sleeper-update.py run failed (see /var/log/sleeper-update.log)"
fi

if echo "$changed" | grep -q '^build/ffpros-update\.py$'; then
  echo "deploy: running ffpros-update.py now (source changed)"
  flock -n /tmp/sc-ffpros.lock /usr/bin/python3 /boot/config/ffpros-update.py \
    >>/var/log/ffpros-update.log 2>&1 || echo "deploy: ffpros-update.py run failed (see /var/log/ffpros-update.log)"
fi

# ffpros-api.py is deliberately NOT run on source change. Every other builder
# here is free to re-run; that one spends from a 50-a-day allowance, and this
# deploy fires on a 5-minute cron. Editing it would drain the day's budget
# before the file was even finished. ffpros-gate.py owns when it runs.

if echo "$changed" | grep -q '^build/warroom-update\.py$'; then
  echo "deploy: running warroom-update.py now (source changed)"
  flock -n /tmp/sc-warroom.lock /usr/bin/python3 /boot/config/warroom-update.py \
    >>/var/log/warroom-update.log 2>&1 || echo "deploy: warroom-update.py run failed (see /var/log/warroom-update.log)"
fi

if echo "$changed" | grep -q '^build/outlook-update\.py$'; then
  echo "deploy: running outlook-update.py now (source changed)"
  flock -n /tmp/sc-outlook.lock /usr/bin/python3 /boot/config/outlook-update.py \
    >>/var/log/outlook-update.log 2>&1 || echo "deploy: outlook-update.py run failed (see /var/log/outlook-update.log)"
fi

echo "deploy: done"
