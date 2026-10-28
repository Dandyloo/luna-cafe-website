// scripts/e2e-menu.mjs
// Browser checks for the menu redesign (item sheet, order bar, deep links, chips, rail, search).
// Saves screenshots to qa-screenshots/ so you can eyeball the result.
//
// One-time setup:   npm i -D playwright   then   npx playwright install chromium
// Every run:        terminal 1: npm run build && npm run preview
//                   terminal 2: npm run e2e        (set BASE_URL if the preview isn't on :4321)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE_URL || "http://localhost:4321").replace(/\/$/, "");
const OUT = "qa-screenshots";
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
    if (!ok) failed++;
};
const settle = (page, ms = 350) => page.waitForTimeout(ms);

const browser = await chromium.launch();

async function fresh(viewport, mobile = false) {
    const ctx = await browser.newContext({
        viewport,
        deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile,
        hasTouch: mobile,
        reducedMotion: "reduce", // makes smooth scrolling and animations instant and repeatable
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    return { ctx, page, errors };
}

const cartLines = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("luna-cart-v1") || "[]"));
const catalog = (page) => page.evaluate(() => JSON.parse(document.getElementById("menu-data").textContent).items);

/* ---------------- phone ---------------- */
{
    const { ctx, page, errors } = await fresh({ width: 390, height: 844 }, true);
    await page.goto(`${BASE}/menu/`, { waitUntil: "networkidle" });

    check("phone: chip bar visible", await page.locator("#menu-chips").isVisible());
    check("phone: desktop rail hidden", !(await page.locator("[data-rail-nav]").isVisible()));
    await page.screenshot({ path: `${OUT}/1-phone-menu.png` });

    const multi = page.locator("li[data-menu-item]:has(button[data-open-item][aria-hidden='true'])").first();
    const multiId = await multi.getAttribute("data-item-id");
    const items = await catalog(page);
    const item = items.find((i) => i.id === multiId);
    const nameButton = () => page.locator(`li[data-item-id="${multiId}"] button[data-open-item]`).first();

    // Open the sheet, pick the second size, quantity 2, add
    await nameButton().click();
    await settle(page);
    const dlg = page.locator("#item-dialog");
    check("sheet opens when a tile is tapped", await dlg.isVisible());
    check("URL gets ?item=", page.url().includes(`item=${multiId}`), page.url());
    check("sheet shows size cards", (await page.locator("input[name='item-size']").count()) >= 2);
    await page.screenshot({ path: `${OUT}/2-phone-item-sheet.png` });

    await page.locator("label[for^='item-size-']").nth(1).click();
    await page.locator("[data-item-qty='1']").click();
    const expected = item.options[1].price * 2;
    const addText = await page.locator("#item-add").innerText();
    check(`Add button shows live total (2 x ${item.options[1].price})`, addText.includes(`GHS ${expected}`), addText);

    await page.locator("#item-add").click();
    await settle(page);
    check("sheet closes after Add", !(await dlg.isVisible()));
    await page.waitForFunction(() => !location.search.includes("item="));
    check("URL is clean again", !page.url().includes("item="), page.url());

    const lines = await cartLines(page);
    check(
        "cart holds the right item, size and quantity",
        lines.length === 1 && lines[0].id === multiId && lines[0].k === item.options[1].k && lines[0].q === 2,
        JSON.stringify(lines),
    );
    check(
        "order bar shows the total",
        (await page.locator("#cart-fab").isVisible()) &&
            (await page.locator("#cart-fab-total").innerText()).includes(`GHS ${expected}`),
    );
    await page.screenshot({ path: `${OUT}/3-phone-order-bar.png` });

    // Quick add on a single-size item
    const single = page.locator("li[data-menu-item]:has(button[data-add])").first();
    const singleId = await single.getAttribute("data-item-id");
    await single.locator("button[data-add]").click();
    await settle(page, 200);
    check("quick-add (+) adds a single-size item", (await cartLines(page)).some((l) => l.id === singleId && l.q === 1));

    // Back button closes the sheet
    await nameButton().click();
    await settle(page);
    await page.goBack();
    await settle(page);
    check("back button closes the sheet", !(await dlg.isVisible()));
    check("...and stays on the menu", page.url().includes("/menu/") && !page.url().includes("item="), page.url());

    // Escape closes it and leaves no extra history entry
    await nameButton().click();
    await settle(page);
    await page.keyboard.press("Escape");
    await settle(page);
    check("Escape closes the sheet", !(await dlg.isVisible()));
    await page.goBack();
    await settle(page, 500);
    check("no leftover history entry (back leaves the menu)", !page.url().includes("/menu/"), page.url());
    await page.goto(`${BASE}/menu/`, { waitUntil: "networkidle" });

    // Category chips
    const chip = page.locator("[data-chip]").nth(5);
    const targetId = await chip.getAttribute("data-chip");
    await chip.click();
    await settle(page, 600);
    check("tapping a chip marks it active", (await chip.getAttribute("aria-current")) === "true");
    const top = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, targetId);
    check("...and scrolls its section into view", top > 0 && top < 400, `top=${Math.round(top)}px`);
    await page.screenshot({ path: `${OUT}/4-phone-chips.png` });

    // Search
    await page.fill("#menu-search", "coffee");
    await settle(page);
    const tiles = await page.locator("li[data-menu-item]:visible").count();
    const chips = await page.locator("[data-chip]:visible").count();
    check("search narrows tiles and chips", tiles > 0 && tiles < items.length && chips < 14, `${tiles} tiles, ${chips} chips`);
    await page.fill("#menu-search", "");

    // Order drawer
    await page.locator("#cart-fab").click();
    await settle(page);
    check("order drawer opens from the bar", await page.locator("#cart-dialog").isVisible());
    await page.screenshot({ path: `${OUT}/5-phone-order-drawer.png` });
    await page.keyboard.press("Escape");

    // Order bar on another page
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    check("order bar also shows on the home page", await page.locator("#cart-fab").isVisible());

    // Shared links
    await page.goto(`${BASE}/menu/?item=${multiId}`, { waitUntil: "networkidle" });
    await settle(page);
    check("shared link opens that item", await page.locator("#item-dialog").isVisible());
    check("...showing the right name", (await page.locator("#item-title").innerText()).trim() === item.name);
    await page.goto(`${BASE}/menu/?item=not-a-real-item`, { waitUntil: "networkidle" });
    await settle(page);
    check("unknown item id is ignored and cleaned", !(await page.locator("#item-dialog").isVisible()) && !page.url().includes("item="), page.url());

    check("phone: no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
}

/* ---------------- desktop ---------------- */
{
    const { ctx, page, errors } = await fresh({ width: 1280, height: 900 });
    await page.goto(`${BASE}/menu/`, { waitUntil: "networkidle" });

    check("desktop: rail visible", await page.locator("[data-rail-nav]").isVisible());
    check("desktop: chip bar hidden", !(await page.locator("#menu-chips").isVisible()));

    const link = page.locator("[data-rail]").nth(6);
    await link.click();
    await settle(page, 600);
    check("rail link becomes active after click", (await link.getAttribute("aria-current")) === "true");
    await page.screenshot({ path: `${OUT}/6-desktop-menu.png` });

    await page.locator("li[data-menu-item]:has(button[data-open-item]) button[data-open-item]").first().click();
    await settle(page);
    const box = await page.locator(".item-sheet").boundingBox();
    check("desktop: item sheet is a centered modal", !!box && Math.abs(box.x + box.width / 2 - 640) < 6, box ? `centre x=${Math.round(box.x + box.width / 2)}` : "no box");
    await page.screenshot({ path: `${OUT}/7-desktop-item-modal.png` });

    check("desktop: no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll browser checks passed");
console.log(`Screenshots saved in ${OUT}/`);
process.exit(failed ? 1 : 0);
