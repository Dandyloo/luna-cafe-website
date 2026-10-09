// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// Set SITE_URL at build time (e.g. SITE_URL=https://yourdomain.com) so canonical URLs,
// Open Graph URLs, sitemap.xml and robots.txt are generated with absolute links.
const site = process.env.SITE_URL;

// https://astro.build/config
export default defineConfig({
  site,
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  vite: {
    plugins: [tailwindcss()]
  }
});
