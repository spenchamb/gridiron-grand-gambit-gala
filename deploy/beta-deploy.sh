#!/bin/bash
# Beta site (port 383) — builds the Next export and lays it over the still-vanilla
# pages. Invoked by the thin wrapper at /boot/config/beta-deploy.sh, which does the
# git pull and execs this; keeping the build here means it is version-controlled
# and changes with the code it builds.
#
# The migration is complete — every page is a Next route, so this simply syncs
# the export. The old two-stage overlay (vanilla first, export over the top) is
# gone along with the vanilla pages.
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

# 1) The export IS the site now — there are no vanilla pages left to overlay,
#    so this syncs with --delete to clear removed routes. data/ is excluded
#    because it is a bind mount pointing at the live sleeper data; deleting it
#    would strand the mount on a dead inode.
rsync -a --delete --exclude='data' --exclude='data/**' \
  "$SRC/web/out/" "$DST/sleeper/"

# 2) Shared assets. Nothing on beta uses them any more, but syncing without
#    --delete keeps the two docroots consistent.
rsync -a "$SRC/www/assets/" "$DST/assets/" 2>/dev/null || true

cp "$SRC"/ffb/icons/favicon.svg "$SRC"/ffb/icons/apple-touch-icon.png "$DST"/ 2>/dev/null || true

oldc=$(md5sum /mnt/cache/appdata/sws-beta/config.toml 2>/dev/null | cut -d' ' -f1 || true)
cp "$SRC/sws/config.toml" /mnt/cache/appdata/sws-beta/config.toml
newc=$(md5sum /mnt/cache/appdata/sws-beta/config.toml | cut -d' ' -f1)
if [ "$oldc" != "$newc" ]; then
  docker restart static-web-beta >/dev/null
  echo "beta: restarted (config)"
fi
echo "beta: done"
