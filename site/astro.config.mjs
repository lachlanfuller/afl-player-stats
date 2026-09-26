import { defineConfig } from "astro/config";

// Deployed to GitHub Pages by .github/workflows/deploy.yml, which sets SITE_BASE and SITE_URL
// for that sub-path. Building locally without them serves from the root, as npm run dev does.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.SITE_BASE || "/",
  trailingSlash: "always",
  build: { format: "directory" },
  // Keep scripts as separate files. Inlined, they would be repeated in all 13,000+ player pages
  // and downloaded again on every visit instead of being cached.
  vite: { build: { assetsInlineLimit: 0 } },
});
