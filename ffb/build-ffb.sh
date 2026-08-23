#!/bin/bash
# Assemble the FF-only bundle served on gridirongrandgambitgala.xyz (port 381).
#
# This used to flatten the personal site's /sleeper pages to the root and patch
# them with sed. Both of those are gone:
#
#   - Flattening cannot work against the Next build. The site bundle is compiled
#     with basePath=/sleeper baked into every asset URL, so moving its files to
#     the root would break all of them. Instead there is a second build,
#     `npm run build:ffb`, compiled with no basePath and DATA_BASE=/data. This
#     script consumes that output; deploy.sh produces it.
#   - The sed scrubbing is replaced by NEXT_PUBLIC_FF_ONLY, set by that same
#     build script. See "the mount-point model" in CLAUDE.md.
#
# Usage: build-ffb.sh <export-dir>     (defaults to the repo's web/out)
set -euo pipefail

SRC="${1:-/mnt/cache/appdata/ffb-src/web/out}"
DST=/mnt/cache/appdata/www-ffb
ICONS="${FFB_ICONS:-/mnt/cache/appdata/ffb-src/ffb/icons}"

[ -d "$SRC" ] || { >&2 echo "build-ffb: no export at $SRC — run 'npm run build:ffb' first"; exit 1; }
[ -f "$SRC/index.html" ] || { >&2 echo "build-ffb: $SRC has no index.html — wrong dir or a failed build"; exit 1; }

# NOTE: never `rm -rf "$DST"` and never write into "$DST/data". The container
# bind-mounts the docroot, and data/ is a *separate* bind mount pointing at the
# live sleeper data. Deleting either strands the mount on a dead inode.
mkdir -p "$DST" "$DST/data"

# 1) The FF-flavoured export. --delete keeps removed routes from lingering, but
#    data/ is excluded so the bind mount is untouched.
rsync -a --delete --exclude='data' --exclude='data/**' "$SRC/" "$DST/"

# 2) GGGG icon set — overrides the personal site's so the FF domain carries its
#    own identity on a desktop tab and an iOS home screen.
cp "$ICONS"/favicon.svg "$ICONS"/favicon.ico "$ICONS"/favicon-32.png \
   "$ICONS"/apple-touch-icon.png "$ICONS"/icon-192.png "$ICONS"/icon-512.png "$DST"/

# 3) FF-branded PWA manifest
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

echo "Built FF-only bundle at $DST"

# 4) Assert the bundle is actually the FF flavour and not a copy of the site
#    build. A basePath mismatch is silent at build time and fatal at runtime —
#    every script and stylesheet 404s — so it fails the deploy here instead.
#    (deploy.sh runs this with >/dev/null, hence stderr.)
if grep -qs '"/sleeper/_next/' "$DST/index.html"; then
  >&2 echo "  ERROR: $DST/index.html references /sleeper/_next — that is the site build."
  >&2 echo "         The FF bundle must come from 'npm run build:ffb' (no basePath)."
  exit 1
fi
grep -qs '/_next/static' "$DST/index.html" \
  && echo "  index.html: root-relative _next URLs OK" \
  || { >&2 echo "  ERROR: $DST/index.html has no _next asset URLs — build looks broken"; exit 1; }
[ -d "$DST/data" ] \
  && echo "  data/ mountpoint intact" \
  || { >&2 echo "  ERROR: $DST/data missing — the live data bind mount is stranded"; exit 1; }
