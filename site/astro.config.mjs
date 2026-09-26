import { defineConfig } from "astro/config";

// Hosting is not decided yet. Set SITE_BASE (for example "/afl-player-stats/" on GitHub Pages)
// and SITE_URL when building for a host that serves the site from a sub-path.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.SITE_BASE || "/",
  trailingSlash: "always",
  build: { format: "directory" },
  // Keep scripts as separate files. Inlined, they would be repeated in all 13,000+ player pages
  // and downloaded again on every visit instead of being cached.
  vite: { build: { assetsInlineLimit: 0 } },
});
