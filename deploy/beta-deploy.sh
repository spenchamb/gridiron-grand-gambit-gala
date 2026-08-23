#!/bin/bash
# Beta site (port 383) — builds the Next export and lays it over the still-vanilla
# pages. Invoked by the thin wrapper at /boot/config/beta-deploy.sh, which does the
# git pull and execs this; keeping the build here means it is version-controlled
# and changes with the code it builds.
#
# Ordering is the whole trick: the vanilla pages sync first (with --delete, so
# removals propagate), then the export is laid over the top without --delete. A
# route that exists in both stacks resolves to the Next one, which is what makes
# a half-ported site work.
set -euo pipefail

SRC=/mnt/cache/appdata/ffb-src-beta
DST=/mnt/cache/appdata/www-beta
export PATH="/usr/local/bin:$PATH"

cd "$SRC/web"

# npm ci is slow (~30s) and only matters when the lockfile moved. Fall back to a
# full install when node_modules is absent (first run after this lands).
if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.package-lock-stamp 2>/dev/null; then
  echo "beta: npm ci"
  npm ci --no-audit --no-fund
  cp package-lock.json node_modules/.package-lock-stamp
fi

# Build BEFORE touching the docroot: set -e means a failed build aborts here and
# the live site keeps serving the previous deploy rather than a half-written one.
echo "beta: next build"
npm run build:site

cd "$SRC"

# 1) Vanilla pages (data/ is generated on the server and never synced)
rsync -a --delete --exclude='data' --exclude='data/**' \
  --exclude='_next' --exclude='_next/**' \
  "$SRC/www/sleeper/" "$DST/sleeper/"

# 2) Next export laid over the top — no --delete, so it cannot remove the
#    vanilla pages it has not replaced yet.
rsync -a "$SRC/web/out/" "$DST/sleeper/"

# 3) Shared assets, still consumed by the vanilla pages
rsync -a "$SRC/www/assets/" "$DST/assets/"

cp "$SRC"/ffb/icons/favicon.svg "$SRC"/ffb/icons/apple-touch-icon.png "$DST"/ 2>/dev/null || true

oldc=$(md5sum /mnt/cache/appdata/sws-beta/config.toml 2>/dev/null | cut -d' ' -f1 || true)
cp "$SRC/sws/config.toml" /mnt/cache/appdata/sws-beta/config.toml
newc=$(md5sum /mnt/cache/appdata/sws-beta/config.toml | cut -d' ' -f1)
if [ "$oldc" != "$newc" ]; then
  docker restart static-web-beta >/dev/null
  echo "beta: restarted (config)"
fi
echo "beta: done"
