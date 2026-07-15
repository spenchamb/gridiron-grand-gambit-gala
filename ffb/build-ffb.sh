#!/bin/bash
# Assemble the FF-only bundle served on gridirongrandgambitgala.com.
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

# 5. Scrub outside references from the bundle copies
#    a) app.js: drop the two Sitemap nav links (sidebar + mobile "More" sheet)
sed -i '\#href="/sitemap.html"#d' "$DST"/assets/app.js
#    b) changelog.html footer: drop the sitemap anchor + its separator
sed -i 's#<a href="/sitemap.html">sitemap</a> &middot; ##' "$DST"/changelog.html
#    c) Home button: redundant on the FF-only site (root IS the league hub).
#       Drop the two nav Home buttons (sidebar + "More" sheet) ...
sed -i '\#>Home</span>#d' "$DST"/assets/app.js
#       ... and the "home" link in every page footer (with or without separator).
sed -i 's# &middot; <a href="/index.html">home</a>##; s#<a href="/index.html">home</a>##' "$DST"/*.html
#    d) Desktop favicon: point the injected <link rel=icon> at the raster PNG
#       (universally rendered) instead of a text-based SVG. Mobile/PWA icons are
#       already PNG via the manifest + apple-touch-icon link.
sed -i "s#type: 'image/svg+xml', href: '/favicon.svg'#type: 'image/png', href: '/favicon-32.png'#" "$DST"/assets/app.js

echo "Built FF-only bundle at $DST:"
ls "$DST"
echo "sitemap refs remaining (should be 0):"
grep -rc 'sitemap.html' "$DST" | grep -v ':0$' || echo "  none"
