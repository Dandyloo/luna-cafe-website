// scripts/generate-icons.mjs
// Builds every favicon / app icon / social-share image from public/logo.jpg.
// Run with:  npm run icons
// Re-run it whenever the logo changes, then commit the generated files in /public.
//
// Output (all in /public):
//   favicon.ico            16 + 32 + 48 px, for browser tabs and old browsers
//   favicon-48.png         48 px PNG, the size Google Search wants (multiples of 48)
//   favicon-96.png         96 px PNG, sharper version for Google Search / high-DPI tabs
//   apple-touch-icon.png   180 px, for iPhone/iPad home screens
//   icon-192.png           192 px, web app manifest
//   icon-512.png           512 px, web app manifest
//   icon-maskable-512.png  512 px with a safe margin, for Android adaptive icons
//   og-image.jpg           1200 x 630, link previews (WhatsApp, Facebook, X, Google)

import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = (file) => path.join(root, "public", file);

const CREAM = "#fff7e8"; // --color-brand-bg
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * The logo file has a white backdrop. Flood-fill from the edges and make that backdrop
 * transparent, so the white lettering inside the badge is kept but the box around it goes.
 */
async function cutOut(buf) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const light = (p, min) => data[p * 4] >= min && data[p * 4 + 1] >= min && data[p * 4 + 2] >= min;
    const clear = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
        const p = y * w + x;
        if (!clear[p] && light(p, 225)) {
            clear[p] = 1;
            stack.push(p);
        }
    };
    for (let x = 0; x < w; x++) (push(x, 0), push(x, h - 1));
    for (let y = 0; y < h; y++) (push(0, y), push(w - 1, y));
    while (stack.length) {
        const p = stack.pop();
        const x = p % w;
        const y = (p / w) | 0;
        if (x > 0) push(x - 1, y);
        if (x < w - 1) push(x + 1, y);
        if (y > 0) push(x, y - 1);
        if (y < h - 1) push(x, y + 1);
    }
    // Remove the 1px light halo left where the badge edge was anti-aliased against the white
    const halo = [];
    for (let p = 0; p < w * h; p++) {
        if (clear[p] || !light(p, 170)) continue;
        const x = p % w;
        const y = (p / w) | 0;
        if ((x > 0 && clear[p - 1]) || (x < w - 1 && clear[p + 1]) || (y > 0 && clear[p - w]) || (y < h - 1 && clear[p + w])) halo.push(p);
    }
    for (const p of halo) clear[p] = 1;
    for (let p = 0; p < w * h; p++) if (clear[p]) data[p * 4 + 3] = 0;
    return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// The logo without its white margin and backdrop
const logo = await sharp(
    await cutOut(await sharp(pub("logo.jpg")).trim({ background: "#ffffff", threshold: 30 }).toBuffer()),
)
    .trim()
    .png()
    .toBuffer();

/** Logo centred on a square tile. `fill` is how much of the tile the logo may use (0 to 1). */
async function tile(size, { background = CLEAR, fill = 0.94 } = {}) {
    const inner = Math.round(size * fill);
    const mark = await sharp(logo).resize({ width: inner, height: inner, fit: "inside" }).toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background } })
        .composite([{ input: mark, gravity: "centre" }])
        .png({ compressionLevel: 9, palette: size >= 150, quality: 92 })
        .toBuffer();
}

/** Packs PNG images into a .ico file (PNG-in-ICO works in every current browser). */
function ico(images) {
    const head = Buffer.alloc(6);
    head.writeUInt16LE(1, 2); // type: icon
    head.writeUInt16LE(images.length, 4);
    let offset = 6 + 16 * images.length;
    const entries = images.map(({ size, buf }) => {
        const e = Buffer.alloc(16);
        e[0] = e[1] = size >= 256 ? 0 : size;
        e.writeUInt16LE(1, 4); // colour planes
        e.writeUInt16LE(32, 6); // bits per pixel
        e.writeUInt32LE(buf.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += buf.length;
        return e;
    });
    return Buffer.concat([head, ...entries, ...images.map((i) => i.buf)]);
}

const out = [];
const save = async (file, data) => {
    await writeFile(pub(file), data);
    out.push(file);
};

// Browser tab icons: transparent background so they sit nicely on light and dark tabs
const tabs = await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await tile(size) })));
await save("favicon.ico", ico(tabs));

// Plain PNG favicons. Google Search needs a real raster/vector icon whose size is a multiple of 48px;
// the old SVG only wrapped a PNG, which Google's favicon crawler tends to ignore.
await save("favicon-48.png", await tile(48));
await save("favicon-96.png", await tile(96));

// Home-screen icons: solid cream background (iOS fills transparency with black)
await save("apple-touch-icon.png", await tile(180, { background: CREAM, fill: 0.84 }));
await save("icon-192.png", await tile(192, { background: CREAM, fill: 0.84 }));
await save("icon-512.png", await tile(512, { background: CREAM, fill: 0.84 }));
await save("icon-maskable-512.png", await tile(512, { background: CREAM, fill: 0.62 }));

// Link-preview image (1200 x 630 is the standard size for Facebook, WhatsApp, X and Google)
const preview = await sharp(logo).resize({ height: 440, fit: "inside" }).toBuffer();
await save(
    "og-image.jpg",
    await sharp({ create: { width: 1200, height: 630, channels: 4, background: CREAM } })
        .composite([{ input: preview, gravity: "centre" }])
        .flatten({ background: CREAM })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer(),
);

console.log("Generated in /public:\n  " + out.join("\n  "));
