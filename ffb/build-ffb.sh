#!/bin/bash
# Assemble the FF-only bundle served on gridirongrandgambitgala.xyz.
# Flattened: the league hub (sleeper/index.html) becomes the site root, so URLs
# are clean (/team.html?owner=...) and carry no cross-site references.
# Data is NOT copied here — the container bind-mounts the live sleeper/data dir
# read-only, so the FF domain always sees fresh cron-built JSON.
# Idempotent: safe to re-run. This is the seed for the future git deploy pipeline.
set -euo pipefail

SRC=/mnt/cache/appdata/www-data
DST=/mnt/cache/appdata/www-ffb
# GGGG icon set (favicon.svg/.ico, apple-touch, PWA png) lives in the repo clone.
ICONS="${FFB_ICONS:-/mnt/cache/appdata/ffb-src/ffb/icons}"

# NOTE: never `rm -rf "$DST"` — the running container bind-mounts it; deleting the
# dir strands the mount on a dead inode (everything 404s until a restart). Clean
# only the managed files, and never touch data/ (it's a live read-only bind mount).
mkdir -p "$DST/assets" "$DST/data"   # data/ is the mountpoint for the live bind mount
rm -f "$DST"/*.html "$DST"/*.png "$DST"/*.ico "$DST"/favicon.svg "$DST"/manifest.webmanifest
rm -rf "$DST"/assets && mkdir -p "$DST"/assets

# 1. FF pages, flattened out of /sleeper (HTML only; skip legacy app.js/style.css,
#    _old/, and data/ — assets come from /assets, data via bind mount)
cp "$SRC"/sleeper/*.html "$DST"/

# 2. Live shared assets (all of them: style.css, app.js, viz.css, viz.js, fonts/, ...)
cp -r "$SRC"/assets/* "$DST"/assets/

# 3. GGGG icon set (favicon for desktop tabs, apple-touch for iOS home screen,
#    192/512 PNGs for the PWA install). These override the main site's icons so
#    the FF domain carries its own GGGG identity.
cp "$ICONS"/favicon.svg "$ICONS"/favicon.ico "$ICONS"/favicon-32.png \
   "$ICONS"/apple-touch-icon.png "$ICONS"/icon-192.png "$ICONS"/icon-512.png "$DST"/

# 4. FF-branded PWA manifest (GGGG icon set)
cat > "$DST"/manifest.webmanifest <<'EOF'
{
  "name": "The Gridiron Grand Gambit Gala",
  "short_name": "GGGG",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a120c",
  "theme_color": "#1a120c",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" },
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
EOF

# 5. Nothing to scrub.
#    Outside references (sitemap/Home nav links, the site footer links, and the
#    favicon flavour) used to be sed'd out of the copied app.js and *.html here.
#    That only ever worked because app.js shipped as unminified plain text: the
#    patterns would silently no-op against a bundled or minified build and leak
#    /sitemap.html and /index.html onto the FF domain with no error.
#
#    They are now decided at runtime from the mount point. Pages under /sleeper
#    (or /nba) on the personal site keep the links; this bundle serves them
#    flattened at the root, so app.js sets FF_ONLY and omits the nav entries,
#    and the inline <head> script sets data-ff="1" so CSS hides the footer's
#    .site-only spans before first paint. See "Where this bundle is mounted"
#    in www/assets/app.js.

echo "Built FF-only bundle at $DST:"
ls "$DST"
# The bundle now legitimately contains these hrefs; what matters is that the
# runtime switch that suppresses them shipped intact.
echo "runtime FF switch:"
grep -q 'FF_ONLY' "$DST/assets/app.js"   && echo "  app.js: FF_ONLY present"   || { echo "  ERROR: app.js has no FF_ONLY guard - outside links would leak"; exit 1; }
grep -q 'data-ff' "$DST/assets/style.css"   && echo "  style.css: data-ff rule present"   || { echo "  ERROR: style.css has no data-ff rule - footer links would leak"; exit 1; }
grep -q "dataset.ff" "$DST/index.html"   && echo "  index.html: boot script present"   || { echo "  ERROR: index.html has no mount-point boot script"; exit 1; }
