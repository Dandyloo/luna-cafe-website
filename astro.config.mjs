// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

import tailwindcss from '@tailwindcss/vite';

// Set SITE_URL (e.g. https://lunacafe.com, no trailing slash) so canonical URLs, Open Graph URLs,
// sitemap.xml, robots.txt and structured data are generated with absolute links.
// It can come from the hosting dashboard's environment variables, the command line
// (SITE_URL=https://... npm run build) or a local .env file (see .env.example).
const site = process.env.SITE_URL || loadEnv('production', process.cwd(), '').SITE_URL || undefined;

// https://astro.build/config
export default defineConfig({
  site,
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  vite: {
    plugins: [tailwindcss()]
  }
});
