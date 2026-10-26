// scripts/qa-check.mjs
// Dependency-free post-build QA. Run with: npm run qa
// Fails (exit 1) on errors so it can gate CI/deploys; prints warnings otherwise.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";
const errors = [];
const warnings = [];

// SITE_URL from the environment or a local .env file (same places astro.config.mjs looks)
const siteUrl =
    process.env.SITE_URL ||
    (existsSync(".env") ? readFileSync(".env", "utf8").match(/^\s*SITE_URL\s*=\s*["']?([^"'\s#]+)/m)?.[1] : undefined);

if (!existsSync(DIST)) {
    console.error("dist/ not found. Run `npm run build` first (or use `npm run qa`).");
    process.exit(1);
}

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

const htmlFiles = walk(DIST).filter((f) => f.endsWith(".html"));

for (const file of htmlFiles) {
    const rel = relative(DIST, file);
    const html = readFileSync(file, "utf8");
    const is404 = rel === "404.html";
    const err = (m) => errors.push(`${rel}: ${m}`);
    const warn = (m) => warnings.push(`${rel}: ${m}`);

    if (!/<html[^>]*\slang=/.test(html)) err("missing <html lang>");

    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
    if (!title) err("missing <title>");
    else if (title.length > 65) warn(`title is ${title.length} chars (aim for ≤ 60)`);

    const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
    if (!desc) err("missing meta description");
    else if (desc.length > 170) warn(`meta description is ${desc.length} chars (aim for ≤ 160)`);

    const h1s = (html.match(/<h1[\s>]/g) || []).length;
    if (h1s !== 1) err(`expected exactly 1 <h1>, found ${h1s}`);

    if (!/<meta name="viewport"/.test(html)) err("missing viewport meta");

    if (!is404) {
        if (!/<link rel="canonical"/.test(html)) warn("no canonical link (set SITE_URL at build time)");
        if (!/property="og:title"/.test(html)) warn("no Open Graph tags");
    }

    for (const img of html.match(/<img\b[^>]*>/g) || []) {
        if (!/\salt=/.test(img)) err(`<img> without alt: ${img.slice(0, 80)}`);
        if (!/\swidth=/.test(img) || !/\sheight=/.test(img))
            warn(`<img> without width/height (layout shift): ${img.slice(0, 80)}`);
    }

    for (const a of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || []) {
        if (!/rel="[^"]*noopener/.test(a)) err(`target=_blank without rel=noopener: ${a.slice(0, 80)}`);
    }

    if (/href="http:\/\//.test(html)) warn("insecure http:// link found");

    // Structured data must be valid JSON; the home page carries the local business listing
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const blocks = [];
    for (const m of ld) {
        try {
            blocks.push(JSON.parse(m[1]));
        } catch {
            err("invalid JSON-LD");
        }
    }
    if (!is404 && blocks.length === 0) err("no JSON-LD structured data");
    const biz = blocks.find((b) => b["@type"] === "CafeOrCoffeeShop");
    if (biz) {
        for (const k of ["name", "telephone", "address", "openingHoursSpecification", "priceRange"])
            if (!biz[k]) err(`local business JSON-LD is missing "${k}"`);
        if (!biz.address?.addressLocality) err("local business JSON-LD: address has no addressLocality");
    }
}

// Launch checks: icons, manifest, social image, sitemap and leftovers
const dist = (f) => join(DIST, f);
const home0 = existsSync(dist("index.html")) ? readFileSync(dist("index.html"), "utf8") : "";

for (const f of ["favicon.ico", "favicon-48.png", "favicon-96.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "og-image.jpg", "site.webmanifest"]) {
    if (!existsSync(dist(f))) errors.push(`missing /${f} (run \`npm run icons\` and rebuild)`);
}
for (const rel of ["favicon.ico", "favicon-48.png", "favicon-96.png", "apple-touch-icon.png", "site.webmanifest"]) {
    if (!home0.includes(`href="/${rel}"`)) errors.push(`index.html does not link /${rel}`);
}
if (existsSync(dist("site.webmanifest"))) {
    try {
        const manifest = JSON.parse(readFileSync(dist("site.webmanifest"), "utf8"));
        for (const icon of manifest.icons ?? [])
            if (!existsSync(dist(icon.src.replace(/^\//, "")))) errors.push(`site.webmanifest: icon ${icon.src} does not exist`);
        if (!manifest.name || !manifest.start_url) errors.push("site.webmanifest: name or start_url missing");
    } catch {
        errors.push("site.webmanifest is not valid JSON");
    }
}
if (existsSync(dist("og-image.jpg")) && statSync(dist("og-image.jpg")).size > 300 * 1024)
    warnings.push("og-image.jpg is over 300 KB (WhatsApp may skip big previews)");

if (!siteUrl) {
    warnings.push("SITE_URL is not set: canonical links, sitemap, robots and social-share URLs are incomplete. Build for production with SITE_URL=https://your-domain");
} else {
    const sm = existsSync(dist("sitemap.xml")) ? readFileSync(dist("sitemap.xml"), "utf8") : "";
    for (const p of ["/", "/menu/", "/about/", "/privacy/"])
        if (!sm.includes(`<loc>${new URL(p, siteUrl).href}</loc>`)) errors.push(`sitemap.xml is missing ${p}`);
    const robots = existsSync(dist("robots.txt")) ? readFileSync(dist("robots.txt"), "utf8") : "";
    if (!robots.includes("Sitemap:")) errors.push("robots.txt has no Sitemap line");
}

// Vercel ignores public/_headers, so the same headers must live in vercel.json (and stay in sync)
try {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    if (vercel.trailingSlash !== true) errors.push("vercel.json: trailingSlash must be true (canonical URLs and the sitemap end in a slash)");
    const cspOf = (headers) => headers?.find((h) => h.key === "Content-Security-Policy")?.value;
    const vercelCsp = cspOf(vercel.headers?.flatMap((r) => r.headers ?? []));
    const fileCsp = readFileSync("public/_headers", "utf8").match(/Content-Security-Policy:\s*(.+)/)?.[1]?.trim();
    if (!vercelCsp) errors.push("vercel.json: Content-Security-Policy header missing");
    else if (fileCsp && vercelCsp !== fileCsp) errors.push("vercel.json and public/_headers have different Content-Security-Policy values (keep them identical)");
    for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"])
        if (!JSON.stringify(vercel.headers ?? []).includes(k)) errors.push(`vercel.json: ${k} header missing`);
} catch (e) {
    errors.push(`vercel.json could not be validated: ${e.message}`);
}

for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    if (/localhost|127\.0\.0\.1|lorem ipsum|TODO|FIXME/i.test(html)) warnings.push(`${relative(DIST, file)}: contains localhost / placeholder / TODO text`);
}

// Validate menu data so a typo can't ship a broken or NaN price
try {
    const menu = JSON.parse(readFileSync("src/data/menu.json", "utf8"));
    const priceKeys = ["price", "priceSmall", "priceMedium", "priceLarge"];
    for (const cat of menu) {
        for (const group of cat.groups ?? []) {
            const seen = new Set();
            for (const item of group.items ?? []) {
                const where = `menu.json › ${cat.name} › ${group.name} › ${item.name ?? "(no name)"}`;
                if (!item.name?.trim()) errors.push(`${where}: empty name`);
                if (seen.has(item.name)) warnings.push(`${where}: duplicate item name in group`);
                seen.add(item.name);
                if ("available" in item && typeof item.available !== "boolean")
                    errors.push(`${where}: available must be true or false`);
                const given = priceKeys.filter((k) => k in item);
                if (given.length === 0) errors.push(`${where}: no price field`);
                for (const k of given) {
                    const v = item[k];
                    if (v !== null && (typeof v !== "number" || !(v > 0)))
                        errors.push(`${where}: ${k} must be a positive number or null (got ${JSON.stringify(v)})`);
                }
            }
        }
    }
} catch (e) {
    errors.push(`menu.json could not be validated: ${e.message}`);
}

// Ordering catalog (embedded by CartDrawer): unique ids, valid options, and every "Add" button
// on the built pages must point at a real item + size
try {
    const home = readFileSync(join(DIST, "index.html"), "utf8");
    const raw = home.match(/<script[^>]*id="menu-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!raw) {
        errors.push("index.html: ordering catalog (#menu-data) not found");
    } else {
        const data = JSON.parse(raw);
        const catalog = new Map();
        if (!/^\d{10,15}$/.test(data.whatsapp ?? "")) errors.push("ordering catalog: invalid WhatsApp number");
        if (!Array.isArray(data.hours) || data.hours.length === 0) errors.push("ordering catalog: opening hours missing");
        if (typeof data.delivery?.enabled !== "boolean")
            errors.push("ordering catalog: delivery settings missing (see DELIVERY in src/lib/config.ts)");
        else if (data.delivery.enabled && !/id="mode-delivery"/.test(home))
            errors.push("index.html: delivery is enabled but the Pickup / Delivery switch is missing");
        for (const item of data.items ?? []) {
            if (!/^[a-z0-9-]+--[a-z0-9-]+$/.test(item.id ?? "")) errors.push(`ordering catalog: odd id "${item.id}"`);
            if (catalog.has(item.id)) errors.push(`ordering catalog: duplicate id "${item.id}"`);
            const keys = new Set();
            for (const o of item.options ?? []) {
                if (keys.has(o.k)) errors.push(`ordering catalog: ${item.id} has duplicate option "${o.k}"`);
                if (typeof o.price !== "number" || !(o.price > 0)) errors.push(`ordering catalog: ${item.id}/${o.k} has a bad price`);
                keys.add(o.k);
            }
            if (keys.size === 0) errors.push(`ordering catalog: ${item.id} has no options`);
            catalog.set(item.id, keys);
        }
        let addButtons = 0;
        for (const file of htmlFiles) {
            const html = readFileSync(file, "utf8");
            for (const m of html.matchAll(/data-add[^>]*?data-id="([^"]+)"[^>]*?data-opt="([^"]+)"/g)) {
                addButtons++;
                if (!catalog.get(m[1])?.has(m[2]))
                    errors.push(`${relative(DIST, file)}: Add button points at unknown item "${m[1]}" / "${m[2]}"`);
            }
        }
        console.log(`Ordering: ${catalog.size} orderable items, ${addButtons} Add buttons checked.`);
    }
} catch (e) {
    errors.push(`ordering catalog could not be validated: ${e.message}`);
}

console.log(`Checked ${htmlFiles.length} HTML page(s) + menu data.`);
if (warnings.length) console.log(`\nWarnings (${warnings.length}):\n- ` + warnings.join("\n- "));
if (errors.length) {
    console.error(`\nErrors (${errors.length}):\n- ` + errors.join("\n- "));
    process.exit(1);
}
console.log("\n✔ QA passed");
