# Luna Café & Eatery Website

Marketing and menu website for **Luna Café & Eatery** in Pedu, Cape Coast, Ghana. Customers browse the menu and place **pickup or delivery** orders through WhatsApp.

Built with [Astro](https://astro.build) and [Tailwind CSS v4](https://tailwindcss.com). It is a fully static site with no backend and no database.

## Requirements

- Node.js **22.12 or newer**
- npm

## Getting started

```sh
npm install
npm run dev
```

The dev server runs at `http://localhost:4321`.

## Commands

| Command              | What it does                                                       |
| :------------------- | :----------------------------------------------------------------- |
| `npm run dev`        | Start the local dev server                                         |
| `npm run build`      | Build the production site into `dist/`                             |
| `npm run preview`    | Serve the production build locally                                 |
| `npm run qa`         | Build, then run `scripts/qa-check.mjs` (SEO, a11y and menu checks) |
| `npm run audit:prod` | Check production dependencies for known vulnerabilities            |

## Project structure

```text
/
├── public/                 Static files served as-is
│   ├── _headers            Security and caching headers (Cloudflare Pages / Netlify)
│   └── *.avif, logo.jpg    Hero images, logo, favicons
├── scripts/
│   └── qa-check.mjs        Post-build QA checks
└── src/
    ├── components/
    │   └── CartDrawer.astro  Order drawer: cart, pickup/delivery form, success screen
    ├── data/menu.json      The menu: edit this to change items and prices
    ├── lib/config.ts       WhatsApp number, opening hours, delivery areas and fees
    ├── scripts/cart.ts     Cart logic and WhatsApp message builder
    ├── layouts/
    │   └── BaseLayout.astro  Header, footer, SEO tags, structured data
    ├── pages/
    │   ├── index.astro     Home
    │   ├── menu.astro      Menu (rendered from menu.json)
    │   ├── 404.astro       Not-found page (noindex)
    │   ├── robots.txt.ts   Generated robots.txt
    │   └── sitemap.xml.ts  Generated sitemap.xml
    ├── styles/global.css   Tailwind import, design tokens, animations
    └── types/menu.ts       TypeScript types for menu.json
```

## Common edits

### Update the menu

Edit `src/data/menu.json`. The structure is categories → groups → items. Each item needs a `name`, an optional `description`, and one of these price shapes:

- `price` for a single price
- `priceSmall` and `priceLarge` for 500ml / 700ml drinks
- `priceMedium` and `priceLarge` for M / L items

Use a number or `null`. `npm run qa` flags missing or invalid prices.

### Going live checklist

1. Set `SITE_URL` to the final address (e.g. `https://lunacafe.com`) in the hosting dashboard's environment variables. A local `.env` file also works (copy `.env.example`).
2. `npm run qa` must pass with **no errors**. Warnings about `SITE_URL` mean canonical links, the sitemap and social previews are incomplete.
3. Tab icons, the home-screen icon and the link-preview image are generated from `public/logo.jpg`. After changing the logo run `npm run icons`, then rebuild.
4. Hosting on Vercel: the security headers and caching live in `vercel.json` (Vercel ignores `public/_headers`). Set `SITE_URL` under Settings → Environment Variables and use Node 22 or newer. Cloudflare Pages or Netlify would read `public/_headers` instead.
5. After it is live: submit `/sitemap.xml` in Google Search Console, claim the Google Business Profile, and send a test order from a phone for both pickup and delivery.

### Change the WhatsApp number, hours or delivery settings

These live in `src/lib/config.ts` (`WHATSAPP_NUMBER`, `HOURS`, `DELIVERY`). The cart reads them from there, so you only change them in one place.

**Delivery:** there is no address field. The order goes to WhatsApp labelled "Delivery", the rider calls the customer to ask where they are, and Luna confirms the delivery fee on WhatsApp. Set `DELIVERY.enabled` to `false` to go back to pickup only.

### Change contact details or socials

The address, phone number, social accounts, footer hours and structured-data block live in `src/layouts/BaseLayout.astro`. The hours are also repeated in `src/pages/index.astro` and `src/pages/about.astro`, so update them there too.

### Add a page

1. Create `src/pages/<name>.astro` using `BaseLayout` and pass a unique `title` and `description`.
2. Add it to the `links` array in `BaseLayout.astro` if it should appear in the nav.
3. Add its path (with a trailing slash) to `pages` in `src/pages/sitemap.xml.ts`.

### Change the theme

Colors and fonts are defined in the `@theme` block in `src/styles/global.css`. Tailwind v4 reads tokens from there. `tailwind.config.mjs` is a leftover from Tailwind v3 and is not used by the build.

## Deployment

Build with the production domain so canonical URLs, Open Graph tags, the sitemap and `robots.txt` use absolute links:

```sh
SITE_URL=https://your-domain.com npm run build
```

On Windows PowerShell:

```powershell
$env:SITE_URL="https://your-domain.com"; npm run build
```

On a hosting platform, set `SITE_URL` as a build environment variable and use `npm run build` as the build command with `dist` as the output directory.

`public/_headers` is picked up automatically by Cloudflare Pages and Netlify. On other hosts, copy its values into that host's header configuration.

## Security notes

- The site ships a Content-Security-Policy, HSTS, `nosniff`, clickjacking protection, a strict referrer policy and a restrictive permissions policy via `public/_headers`.
- If you add a third-party script, font host, image host or embed, update the CSP in `public/_headers` or the browser will block it.
- Never commit secrets. `.env` files are git-ignored; use `.env.example` to document required variables.

## Quality checks

`npm run qa` fails the build on missing `lang`, title, meta description or viewport, anything other than one `<h1>` per page, images without `alt`, `target="_blank"` links without `rel="noopener"`, and invalid menu data. It prints warnings for long titles and descriptions, missing canonical or Open Graph tags, and images without dimensions.
