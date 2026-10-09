import type { APIRoute } from "astro";

// Add new public pages here so they show up in the sitemap.
// Paths use a trailing slash to match Astro's default static output.
const pages = ["/", "/menu/"];

export const GET: APIRoute = ({ site }) => {
    const urls = site
        ? pages
              .map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`)
              .join("\n")
        : "";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

    return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
};
