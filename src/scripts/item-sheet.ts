// src/scripts/item-sheet.ts
// Item details sheet: pick a size and quantity, then hand the choice to the cart.
//
// - Prices and size options come from the menu catalog (#menu-data), the same source the cart uses.
// - Name, group, description and photo come from the tapped tile's data attributes.
// - "Add to order" dispatches `luna:add-item` ({ id, k, qty }); the cart listens for it.
// - Anything can open the sheet with `luna:open-item` ({ id }) or a [data-open-item] tile.

type Option = { k: string; label: string; price: number };
type Item = { id: string; name: string; options: Option[] };

const MAX_QTY = 20;

let index: Map<string, Item> | null = null;
let current: Item | null = null;
let size = "";
let qty = 1;

// History: opening an item adds a `?item=<id>` entry so the back button closes the sheet
let pushed = false; // the open sheet has a history entry we added
let ignoreNextPop = false; // the next popstate is our own history.back()
let sheetPath = "";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T | null;

const money = (n: number) => `GHS ${Number.isInteger(n) ? n : n.toFixed(2)}`;

function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

function catalog(): Map<string, Item> {
    if (index) return index;
    index = new Map();
    try {
        const raw = byId("menu-data")?.textContent;
        if (raw) for (const item of (JSON.parse(raw).items ?? []) as Item[]) index.set(item.id, item);
    } catch {
        /* no catalog: the sheet simply won't open */
    }
    return index;
}

/** "M" and "L" read better spelled out; "500ml" / "700ml" are already clear. */
const sizeName = (label: string) =>
    label === "M" ? "Medium (M)" : label === "L" ? "Large (L)" : label || "Regular";

function renderMedia(name: string, image?: string) {
    const media = byId("item-media");
    if (!media) return;
    if (image) {
        const img = h("img", "h-full w-full object-cover");
        img.src = image;
        img.alt = "";
        media.replaceChildren(img);
    } else {
        const tile = h(
            "div",
            "grid h-full w-full place-items-center font-heading text-7xl font-extrabold text-brand-deep",
            (name.trim()[0] ?? "").toUpperCase(),
        );
        tile.setAttribute("aria-hidden", "true");
        media.replaceChildren(tile);
    }
}

function renderSizes(item: Item) {
    const fieldset = byId("item-sizes");
    const list = byId("item-size-list");
    const single = byId("item-single");
    if (!fieldset || !list || !single) return;

    if (item.options.length > 1) {
        fieldset.hidden = false;
        single.hidden = true;
        list.replaceChildren(
            ...item.options.map((o) => {
                const wrap = h("div", "");
                const input = h("input", "peer sr-only");
                input.type = "radio";
                input.name = "item-size";
                input.id = `item-size-${o.k}`;
                input.value = o.k;
                input.checked = o.k === size;
                const label = h(
                    "label",
                    "flex h-full cursor-pointer flex-col items-center gap-0.5 rounded-2xl border-2 border-brand-shadow/10 bg-white px-3 py-3.5 text-center transition hover:border-brand-shadow/25 peer-checked:border-brand-primary peer-checked:bg-brand-primary/15 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-secondary",
                );
                label.htmlFor = input.id;
                label.append(
                    h("span", "font-extrabold text-brand-shadow", sizeName(o.label)),
                    h("span", "text-sm font-semibold text-brand-text/70", money(o.price)),
                );
                wrap.append(input, label);
                return wrap;
            }),
        );
    } else {
        fieldset.hidden = true;
        list.replaceChildren();
        const only = item.options[0];
        single.hidden = !only?.label;
        single.textContent = only?.label ? `Only available as ${sizeName(only.label)}.` : "";
    }
}

function renderTotal() {
    const opt = current?.options.find((o) => o.k === size);
    const price = opt ? opt.price * qty : 0;
    const add = byId("item-add");
    if (add) add.textContent = `Add to order · ${money(price)}`;
    const q = byId("item-qty");
    if (q) q.textContent = String(qty);
    document.querySelectorAll<HTMLButtonElement>("[data-item-qty]").forEach((b) => {
        const delta = Number(b.dataset.itemQty);
        b.disabled = (delta < 0 && qty <= 1) || (delta > 0 && qty >= MAX_QTY);
    });
}

type OpenMode = "push" | "pop" | "load";

const itemParam = () => new URL(location.href).searchParams.get("item");

function openItem(id: string, mode: OpenMode = "push") {
    const dlg = byId<HTMLDialogElement>("item-dialog");
    const item = catalog().get(id);
    if (!dlg || !item || item.options.length === 0) return;

    const tile = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
    current = item;
    size = item.options[0].k;
    qty = 1;

    const title = byId("item-title");
    if (title) title.textContent = item.name;
    const meta = byId("item-meta");
    if (meta) meta.textContent = tile?.dataset.group ?? "";
    const desc = byId("item-desc");
    if (desc) {
        const text = tile?.dataset.desc ?? "";
        desc.textContent = text;
        desc.hidden = !text;
    }

    renderMedia(item.name, tile?.dataset.image);
    renderSizes(item);
    renderTotal();
    byId("item-dialog")?.querySelector<HTMLElement>(".item-scroll")?.scrollTo({ top: 0 });

    if (mode === "load") tile?.scrollIntoView({ block: "center", behavior: "auto" }); // show it in context behind the sheet

    sheetPath = location.pathname;
    if (mode === "push") {
        const url = new URL(location.href);
        url.searchParams.set("item", id);
        // Keep the router's own history state so page transitions keep working
        if (dlg.open) history.replaceState({ ...history.state }, "", url);
        else {
            history.pushState({ ...history.state }, "", url);
            pushed = true;
        }
    } else if (mode === "pop") {
        pushed = true;
    } else {
        pushed = false; // opened straight from a shared link: no entry of ours to go back to
    }

    if (!dlg.open) dlg.showModal();
    title?.focus();
}

/** Runs whenever the sheet closes (button, backdrop, Escape, add to order, or back button). */
function onSheetClosed() {
    current = null;
    if (pushed) {
        // Remove our history entry; that makes the back button and the close button equivalent
        pushed = false;
        ignoreNextPop = true;
        history.back();
    } else if (itemParam()) {
        const url = new URL(location.href);
        url.searchParams.delete("item");
        history.replaceState({ ...history.state }, "", url);
    }
}

function closeItem() {
    const dlg = byId<HTMLDialogElement>("item-dialog");
    if (dlg?.open) dlg.close();
}

function addToOrder() {
    if (!current) return;
    document.dispatchEvent(
        new CustomEvent("luna:add-item", { detail: { id: current.id, k: size, qty } }),
    );
    closeItem();
}

/* ---------- wiring (document-level, so it survives page transitions) ---------- */

document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;

    const open = t.closest<HTMLElement>("[data-open-item]");
    if (open && !t.closest("[data-add]")) {
        const id = open.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? open.dataset.itemId;
        if (id) openItem(id);
        return;
    }

    const step = t.closest<HTMLElement>("[data-item-qty]");
    if (step) {
        qty = Math.max(1, Math.min(MAX_QTY, qty + Number(step.dataset.itemQty)));
        renderTotal();
        return;
    }

    if (t.closest("#item-add")) return addToOrder();
    // Clicks on the dimmed backdrop land on the <dialog> itself
    if (t.closest("[data-item-close]") || t === byId("item-dialog")) closeItem();
});

document.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | null;
    if (t?.name === "item-size" && current?.options.some((o) => o.k === t.value)) {
        size = t.value;
        renderTotal();
    }
});

document.addEventListener("luna:open-item", (e) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (id) openItem(id);
});

document.addEventListener("astro:before-swap", () => {
    pushed = false; // leaving the page: don't touch history
    closeItem();
    index = null; // the next page brings its own catalog
    current = null;
});

// "close" doesn't bubble, so listen in the capture phase
document.addEventListener(
    "close",
    (e) => {
        if ((e.target as HTMLElement | null)?.id === "item-dialog") onSheetClosed();
    },
    true,
);

// Back/forward. Registered in the capture phase so we claim our own entries before the page
// router sees them (otherwise it would re-render the whole page for a ?item= change).
window.addEventListener(
    "popstate",
    (e) => {
        if (ignoreNextPop) {
            ignoreNextPop = false;
            e.stopImmediatePropagation();
            return;
        }
        if (location.pathname !== sheetPath) return; // a real page change: the router handles it
        const dlg = byId<HTMLDialogElement>("item-dialog");
        const id = itemParam();
        if (id && catalog().has(id)) {
            if (!dlg?.open || current?.id !== id) openItem(id, "pop");
            e.stopImmediatePropagation();
        } else if (dlg?.open) {
            pushed = false; // we arrived here by going back, so the entry is already gone
            dlg.close();
            e.stopImmediatePropagation();
        }
    },
    true,
);

// Shared link: /menu?item=<id> opens that item
document.addEventListener("astro:page-load", () => {
    sheetPath = location.pathname;
    const id = itemParam();
    if (!id) return;
    if (catalog().has(id)) {
        openItem(id, "load");
    } else {
        // Unknown or sold-out item: drop the parameter and show the menu as normal
        const url = new URL(location.href);
        url.searchParams.delete("item");
        history.replaceState({ ...history.state }, "", url);
    }
});
