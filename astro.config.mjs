// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";

// Astro is the "hybrid": static + fast by default, with React islands for
// interactive features (lightbox, filters, contact form) added incrementally.
// `output` stays "static" — every page is still prerendered at build time
// by default. Only routes that opt in with `export const prerender = false`
// (the client portal, /api/* endpoints) run as on-demand Vercel functions.
export default defineConfig({
  // The live origin — used to build absolute URLs (og:image, canonical).
  site: "https://owenmcc.photo",
  integrations: [react()],
  adapter: vercel(),
  image: {
    // Generate modern, well-compressed formats from the source JPEGs.
    responsiveStyles: true,
  },
});
