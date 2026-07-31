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

# 1) FF pages -> docroot/sleeper (never touch generated data/ or legacy _old/)
rsync -a --delete \
  --exclude='data' --exclude='data/**' --exclude='_old' --exclude='_old/**' \
  "$REPO/www/sleeper/" "$DOCROOT/sleeper/"

# 2) Shared assets (also consumed by the NBA section — intended)
rsync -a "$REPO/www/assets/" "$DOCROOT/assets/"

# 2b) Draft War Room — standalone section, shares no assets or data with the
#     fantasy pages, so it syncs on its own and keeps its own generated data/.
rsync -a --exclude='data' --exclude='data/**' "$REPO/www/warroom/" "$DOCROOT/warroom/"

# 3) Builders + FF build tooling into their runtime locations
for f in sleeper-update ffpros-update nfl-windows sleeper-gate warroom-update; do
  install -m 700 "$REPO/build/$f.py" "/boot/config/$f.py"
done
install -m 755 "$REPO/ffb/build-ffb.sh" /boot/config/build-ffb.sh
mkdir -p /mnt/cache/appdata/sws-ffb
old_sws_hash=$(md5sum /mnt/cache/appdata/sws/config.toml 2>/dev/null | cut -d' ' -f1 || true)
old_swsffb_hash=$(md5sum /mnt/cache/appdata/sws-ffb/config.toml 2>/dev/null | cut -d' ' -f1 || true)
install -m 644 "$REPO/sws/config.toml" /mnt/cache/appdata/sws/config.toml
install -m 644 "$REPO/ffb/sws-config.toml" /mnt/cache/appdata/sws-ffb/config.toml

# 4) Rebuild the FF-only bundle (data stays live via the container's bind mount)
bash /boot/config/build-ffb.sh >/dev/null

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

echo "deploy: done"
