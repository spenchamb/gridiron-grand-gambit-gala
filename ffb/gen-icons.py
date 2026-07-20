#!/usr/bin/env python3
"""Regenerate the GGGG FF app-icon set from ffb/icons/app-icon-source.png.
Produces favicon.ico/.svg/-32, apple-touch (180), PWA 192/512. Run from repo root:
  python ffb/gen-icons.py
"""
import base64, io, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "ffb", "icons")
SRC = os.path.join(ICONS, "app-icon-source.png")

src = Image.open(SRC).convert("RGBA")
# Square canvas already; just high-quality downscale per target.
def scaled(px):
    return src.resize((px, px), Image.LANCZOS)

# PWA + apple-touch + favicon-32 (flatten onto the icon's own dark bg for .ico/jpeg-safety)
scaled(512).save(os.path.join(ICONS, "icon-512.png"))
scaled(192).save(os.path.join(ICONS, "icon-192.png"))
scaled(180).save(os.path.join(ICONS, "apple-touch-icon.png"))
scaled(32).save(os.path.join(ICONS, "favicon-32.png"))

# Multi-size .ico for desktop tabs
scaled(256).save(os.path.join(ICONS, "favicon.ico"),
                 sizes=[(16, 16), (32, 32), (48, 48)])

# favicon.svg = the 512 PNG embedded as base64 (guaranteed raster render everywhere)
buf = io.BytesIO(); scaled(512).save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" '
       'viewBox="0 0 512 512"><image width="512" height="512" '
       f'href="data:image/png;base64,{b64}"/></svg>')
open(os.path.join(ICONS, "favicon.svg"), "w").write(svg)

for f in ("favicon.svg","favicon.ico","favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png"):
    p = os.path.join(ICONS, f); print(f"  {f}: {os.path.getsize(p)} bytes")
print("done")
