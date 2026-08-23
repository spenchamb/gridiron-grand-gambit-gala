import type { NextConfig } from "next";

/* Static export only. `next build` emits a plain folder of HTML/CSS/JS in out/
   that rsyncs exactly like www/ does today — same containers, same cron, same
   static-web-server. No Node runtime on the server, no Vercel.

   The two bundles differ only in where they are mounted, which Phase 0 already
   reduced to a single fact. Here it becomes three env vars set by the two build
   scripts in package.json:

     build:site  ->  /sleeper on the personal site (port 380)
     build:ffb   ->  flattened at / for gridirongrandgambitgala.xyz (port 381)

   trailingSlash stays false, so routes emit as `teams.html`. Verified against
   the live static-web-server: /sleeper/teams.html, /sleeper/teams and
   /sleeper/teams/ all resolve, and a genuine miss still 404s — so existing
   .html bookmarks keep working and the client router's extensionless URLs
   survive a hard refresh. */
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  trailingSlash: false,
  // No image optimizer exists in a static export.
  images: { unoptimized: true },
  // Surface type/lint errors at build time rather than shipping past them.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
