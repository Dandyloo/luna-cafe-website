// scripts/qa-check.mjs
// Dependency-free post-build QA. Run with: npm run qa
// Fails (exit 1) on errors so it can gate CI/deploys; prints warnings otherwise.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";
const errors = [];
const warnings = [];

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

console.log(`Checked ${htmlFiles.length} HTML page(s) + menu data.`);
if (warnings.length) console.log(`\nWarnings (${warnings.length}):\n- ` + warnings.join("\n- "));
if (errors.length) {
    console.error(`\nErrors (${errors.length}):\n- ` + errors.join("\n- "));
    process.exit(1);
}
console.log("\n✔ QA passed");
