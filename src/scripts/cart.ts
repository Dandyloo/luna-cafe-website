// src/scripts/cart.ts
// WhatsApp-first ordering cart (pickup or delivery). Everything runs in the browser, with no backend.
//
// - The cart is stored in localStorage as {id, option, qty, extras} only. Names and prices always
//   come from the menu catalog embedded in the page (#menu-data, see CartDrawer.astro),
//   so a stale or edited cart can never change what something costs.
// - "Send" builds an Order (src/lib/order.ts) and hands it to a transport (src/lib/transport.ts).
//   Today that opens WhatsApp with the message pre-filled; later the same Order can be sent
//   to a backend for the staff orders panel without touching this file.

import { buildOrder, isValidPhone, makeOrderRef } from "../lib/order";
import { getTransport, sendOrder, type OrderingMode } from "../lib/transport";

type Option = { k: string; label: string; price: number };
type Extra = { k: string; name: string; price: number };
type Item = { id: string; name: string; options: Option[]; extraSet?: string };
type HoursRule = { days: number[]; open: number; close: number };
type Delivery = { enabled: boolean };
type Catalog = {
    whatsapp: string;
    hours: HoursRule[];
    delivery: Delivery;
    ordering: { mode: OrderingMode };
    extraSets?: Record<string, Extra[]>;
    items: Item[];
};
/** x = keys of the ticked extras (each one applies to every drink on the line). */
type Line = { id: string; k: string; q: number; x?: string[] };
type Resolved = { line: Line; item: Item; opt: Option; extras: Extra[] };
type Mode = "pickup" | "delivery";

const CART_KEY = "luna-cart-v1";
const CUSTOMER_KEY = "luna-customer-v1";
const MAX_QTY = 20;
const MAX_LINES = 30;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let catalog: Catalog | null = null;
let index = new Map<string, Item>();
let lines: Line[] = [];
let mode: Mode = "pickup";
let showSuccess = false;
let sending = false;

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

const show = (id: string, on: boolean) => {
    const el = byId(id);
    if (el) el.hidden = !on;
};

const setText = (id: string, text: string) => {
    const el = byId(id);
    if (el) el.textContent = text;
};

/* ---------- catalog + storage ---------- */

function getCatalog(): Catalog | null {
    if (catalog) return catalog;
    const raw = byId("menu-data")?.textContent;
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Catalog;
        parsed.delivery ??= { enabled: false };
        parsed.ordering ??= { mode: "whatsapp" };
        catalog = parsed;
        index = new Map(catalog.items.map((i) => [i.id, i]));
    } catch {
        return null;
    }
    return catalog;
}

const deliveryEnabled = () => !!getCatalog()?.delivery.enabled;

const extrasOf = (item: Item): Extra[] => (item.extraSet ? (catalog?.extraSets?.[item.extraSet] ?? []) : []);
const xKey = (x?: string[]) => (x ?? []).join(",");

/** Keeps only extras this item really offers, once each, in menu order. */
function cleanExtras(item: Item, raw: unknown): string[] {
    const wanted = new Set(Array.isArray(raw) ? raw.map(String) : []);
    return extrasOf(item)
        .filter((e) => wanted.has(e.k))
        .map((e) => e.k);
}

/** Price of one drink/dish on a line: the size price plus its extras. */
const unitPrice = (r: Resolved) => r.opt.price + r.extras.reduce((n, e) => n + e.price, 0);

function loadCart() {
    lines = [];
    if (!getCatalog()) return;
    try {
        const parsed = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]");
        if (!Array.isArray(parsed)) return;
        for (const raw of parsed) {
            const item = index.get(raw?.id);
            const opt = item?.options.find((o) => o.k === raw?.k);
            const q = Math.min(MAX_QTY, Math.floor(Number(raw?.q)));
            if (!item || !opt || !(q > 0)) continue; // item removed/renamed/sold out since it was saved
            const x = cleanExtras(item, raw?.x);
            const dup = lines.find((l) => l.id === item.id && l.k === opt.k && xKey(l.x) === xKey(x));
            if (dup) dup.q = Math.min(MAX_QTY, dup.q + q);
            else if (lines.length < MAX_LINES) lines.push({ id: item.id, k: opt.k, q, ...(x.length ? { x } : {}) });
        }
    } catch {
        lines = [];
    }
}

function saveCart() {
    try {
        localStorage.setItem(CART_KEY, JSON.stringify(lines));
    } catch {
        /* storage unavailable (private mode etc.): the cart still works for this page view */
    }
}

function resolve(): Resolved[] {
    const out: Resolved[] = [];
    for (const line of lines) {
        const item = index.get(line.id);
        const opt = item?.options.find((o) => o.k === line.k);
        if (item && opt) out.push({ line, item, opt, extras: extrasOf(item).filter((e) => line.x?.includes(e.k)) });
    }
    return out;
}

/* ---------- order sent, waiting for the customer to confirm in WhatsApp ---------- */

// Remembered on this device so the confirmation screen survives a page reload (phones often
// reload the page when you come back from the WhatsApp app) and shows again when you return.
const PENDING_KEY = "luna-pending-v1";
const PENDING_TTL = 6 * 60 * 60 * 1000; // forget after 6 hours
type Pending = { ref: string; mode: Mode; total: number; url?: string; at: number; dismissed?: boolean };

function loadPending(): Pending | null {
    try {
        const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
        if (p && typeof p.ref === "string" && typeof p.total === "number" && Date.now() - Number(p.at) < PENDING_TTL) {
            return { ...p, mode: p.mode === "delivery" ? "delivery" : "pickup" } as Pending;
        }
    } catch {
        /* ignore */
    }
    return null;
}

function savePending(p: Pending | null) {
    try {
        if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
        else localStorage.removeItem(PENDING_KEY);
    } catch {
        /* ignore */
    }
}

/** The customer closed or left the confirmation: keep it available, but don't pop it open again. */
function markDismissed() {
    const p = loadPending();
    if (p && !p.dismissed) savePending({ ...p, dismissed: true });
}

function fillConfirmation(p: Pending) {
    const delivery = p.mode === "delivery";
    setText("cart-ref", p.ref);
    setText("cart-success-type", delivery ? "Delivery" : "Pickup");
    setText("cart-success-total", money(p.total));
    setText(
        "cart-success-next",
        delivery ? "Our rider will call you for your location." : "We message you when it's ready for pickup.",
    );
    const link = byId<HTMLAnchorElement>("cart-wa-link");
    if (link) {
        link.hidden = !p.url;
        if (p.url) link.href = p.url;
    }
}

/** Shows the confirmation again if an order was sent and not yet confirmed (after a reload or coming back to the tab). */
function restoreConfirmation() {
    const p = loadPending();
    if (!p) return;
    if (lines.length === 0) {
        savePending(null); // the order was finished or cleared elsewhere
        return;
    }
    showSuccess = true;
    fillConfirmation(p);
    render();
    const dlg = byId<HTMLDialogElement>("cart-dialog");
    if (dlg && !dlg.open && !p.dismissed) dlg.showModal();
}

/* ---------- pickup / delivery ---------- */

function setMode(next: Mode) {
    mode = next === "delivery" && deliveryEnabled() ? "delivery" : "pickup";
}

function renderMode() {
    const del = mode === "delivery";
    const radio = byId<HTMLInputElement>(del ? "mode-delivery" : "mode-pickup");
    if (radio && !radio.checked) radio.checked = true;

    setText(
        "mode-note",
        del
            ? "No address needed. Our rider will call you to ask where you are."
            : "We'll notify you on WhatsApp when your order is ready for pickup.",
    );
}

/* ---------- opening hours ---------- */

const clock = (mins: number) => `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;

/** Luna's hours are in Africa/Accra time, which is GMT all year, so UTC works as-is. */
function closedMessage(): string | null {
    const hours = getCatalog()?.hours;
    if (!hours?.length) return null;
    const now = new Date();
    const day = now.getUTCDay();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const today = hours.find((r) => r.days.includes(day));
    if (today && mins >= today.open && mins < today.close) return null;

    let when = "";
    if (today && mins < today.open) {
        when = `today at ${clock(today.open)}`;
    } else {
        for (let i = 1; i <= 7; i++) {
            const d = (day + i) % 7;
            const rule = hours.find((r) => r.days.includes(d));
            if (rule) {
                when = `${i === 1 ? "tomorrow" : DAYS[d]} at ${clock(rule.open)}`;
                break;
            }
        }
    }
    return `We're closed right now${when ? ` and open again ${when}` : ""}. You can still send your order and we'll reply once we're open.`;
}

/* ---------- rendering ---------- */

const STEP_ICONS: Record<string, string> = {
    "+": "M12 5v14M5 12h14",
    "\u2212": "M5 12h14",
    "\u00d7": "M6 6l12 12M18 6 6 18",
};

function stepButton(line: Line, delta: number, aria: string, text: string) {
    const b = h(
        "button",
        "grid h-9 w-9 place-items-center rounded-full text-brand-shadow transition hover:bg-brand-primary/40 active:scale-90 disabled:opacity-40",
    );
    // Drawn as an icon (not a text glyph) so the sign sits exactly in the middle of the circle
    b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="${STEP_ICONS[text] ?? STEP_ICONS["+"]}"/></svg>`;
    b.type = "button";
    b.dataset.qty = String(delta);
    b.dataset.id = line.id;
    b.dataset.k = line.k;
    b.dataset.x = xKey(line.x);
    b.setAttribute("aria-label", aria);
    if (delta > 0 && line.q >= MAX_QTY) b.disabled = true;
    return b;
}

function lineRow(r: Resolved) {
    const { line, item, opt, extras } = r;
    const label =
        item.name + (opt.label ? ` ${opt.label}` : "") + (extras.length ? ` with ${extras.map((e) => e.name).join(", ")}` : "");
    // One card per line: thumbnail tile, name, size and extras as tags, line price, then price-each and a stepper
    const li = h("li", "rounded-3xl border border-brand-shadow/10 bg-white p-4 shadow-sm");

    const tile = h(
        "div",
        "grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-primary/15 font-heading text-xl font-extrabold text-brand-deep",
        (item.name.trim()[0] ?? "").toUpperCase(),
    );
    tile.setAttribute("aria-hidden", "true");

    const info = h("div", "min-w-0 flex-1");
    info.append(h("p", "font-semibold leading-snug text-brand-text", item.name));
    const tags = [opt.label, ...extras.map((e) => `+ ${e.name}`)].filter(Boolean);
    if (tags.length) {
        const row = h("div", "mt-1 flex flex-wrap gap-1");
        row.append(
            ...tags.map((t) => h("span", "rounded-full bg-brand-primary/20 px-2.5 py-0.5 text-xs font-semibold text-brand-deep", t)),
        );
        info.append(row);
    }

    const top = h("div", "flex items-start gap-3");
    top.append(tile, info, h("p", "shrink-0 font-extrabold text-brand-shadow", money(line.q * unitPrice(r))));

    const stepper = h("div", "flex items-center rounded-full border border-brand-shadow/15 bg-brand-bg p-0.5");
    stepper.append(
        stepButton(line, -1, line.q === 1 ? `Remove ${label}` : `One less ${label}`, line.q === 1 ? "×" : "−"),
        h("span", "w-8 text-center font-bold", String(line.q)),
        stepButton(line, 1, `One more ${label}`, "+"),
    );

    const bottom = h("div", "mt-3 flex items-center justify-between border-t border-dashed border-brand-shadow/15 pt-3");
    bottom.append(h("p", "text-sm text-brand-text/60", `${money(unitPrice(r))} each`), stepper);

    li.append(top, bottom);
    return li;
}

function render() {
    if (!getCatalog()) return;
    const rows = resolve();
    const count = rows.reduce((n, r) => n + r.line.q, 0);
    const subtotal = rows.reduce((n, r) => n + r.line.q * unitPrice(r), 0);

    const fab = byId("cart-fab");
    if (fab) {
        fab.hidden = count === 0;
        fab.setAttribute(
            "aria-label",
            `View your order: ${count} ${count === 1 ? "item" : "items"}, ${money(subtotal)}`,
        );
    }
    setText("cart-fab-count", String(count));
    setText("cart-fab-total", money(subtotal));

    show("cart-empty", count === 0 && !showSuccess);
    show("cart-content", count > 0 && !showSuccess);
    show("cart-footer", count > 0 && !showSuccess);
    show("cart-success", showSuccess);
    show("cart-clear-confirm", false);
    document.querySelectorAll<HTMLElement>("[data-cart-clear]").forEach((button) => {
        button.hidden = count === 0 || showSuccess;
    });

    renderMode();
    setText("cart-subtotal", money(subtotal));
    setText("cart-total", money(subtotal));
    setText("cart-items-label", `Items (${count})`);
    setText("cart-submit-label", `Send order \u00b7 ${money(subtotal)}`);
    setText(
        "cart-subtitle",
        count > 0 ? `${count} ${count === 1 ? "item" : "items"} \u00b7 Luna Caf\u00e9` : "Luna Caf\u00e9 & Eatery",
    );

    const closed = closedMessage();
    setText("cart-closed", closed ?? "");
    show("cart-closed", !!closed && count > 0 && !showSuccess);

    const list = byId("cart-lines");
    if (!list) return;

    // Keep keyboard focus on the same stepper button after the list is rebuilt
    const active = document.activeElement as HTMLElement | null;
    const key = active?.dataset?.qty
        ? `${active.dataset.id}|${active.dataset.k}|${active.dataset.x ?? ""}|${active.dataset.qty}`
        : null;
    list.replaceChildren(...rows.map(lineRow));
    if (key) {
        const next = Array.from(list.querySelectorAll<HTMLButtonElement>("[data-qty]")).find(
            (b) => `${b.dataset.id}|${b.dataset.k}|${b.dataset.x ?? ""}|${b.dataset.qty}` === key && !b.disabled,
        );
        (next ?? byId("cart-title"))?.focus();
    }
}

function announce(message: string) {
    const live = byId("cart-live");
    if (!live) return;
    live.textContent = "";
    window.setTimeout(() => (live.textContent = message), 60);
}

function bump() {
    const fab = byId("cart-fab");
    if (!fab || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A quick pulse with an orange ring, so people see the order grow
    fab.animate(
        [
            { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(249 128 11 / 0.65)" },
            { transform: "scale(1.04)", boxShadow: "0 0 0 10px rgb(249 128 11 / 0)", offset: 0.6 },
            { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(249 128 11 / 0)" },
        ],
        { duration: 450, easing: "ease-out" },
    );
}

/** Small pop on the + button that was tapped. */
function pop(el: HTMLElement) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }],
        { duration: 280, easing: "ease-out" },
    );
}

/* ---------- cart actions ---------- */

function addItem(id: string, k: string, qty = 1, x: string[] = []) {
    const item = index.get(id);
    const opt = item?.options.find((o) => o.k === k);
    if (!item || !opt) return;
    const xs = cleanExtras(item, x);
    // Adding something starts a new order: the earlier confirmation no longer applies
    if (showSuccess) {
        showSuccess = false;
        savePending(null);
    }
    const label = item.name + (opt.label ? ` (${opt.label})` : "");
    const want = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(qty)) || 1));
    let added = want;

    const existing = lines.find((l) => l.id === id && l.k === k && xKey(l.x) === xKey(xs));
    if (existing) {
        const room = MAX_QTY - existing.q;
        if (room <= 0) {
            announce(`You can order up to ${MAX_QTY} of ${label} online. For bigger orders, please message us on WhatsApp.`);
            return;
        }
        added = Math.min(want, room);
        existing.q += added;
    } else if (lines.length >= MAX_LINES) {
        announce("That's a big order! Please send this one first, then start another.");
        return;
    } else {
        lines.push({ id, k, q: want, ...(xs.length ? { x: xs } : {}) });
    }
    saveCart();
    render();
    bump();
    announce(
        added < want
            ? `Added ${added} x ${label}. ${MAX_QTY} is the most you can order online.`
            : `Added ${added > 1 ? `${added} x ` : ""}${label} to your order.`,
    );
}

function changeQty(id: string, k: string, x: string, delta: number) {
    const line = lines.find((l) => l.id === id && l.k === k && xKey(l.x) === x);
    if (!line) return;
    line.q = Math.min(MAX_QTY, line.q + delta);
    if (line.q <= 0) lines = lines.filter((l) => l !== line);
    saveCart();
    render();
}

function clearCart() {
    lines = [];
    saveCart();
    render();
}

function showClearConfirmation() {
    const confirm = byId<HTMLElement>("cart-clear-confirm");
    if (!confirm) return;
    confirm.hidden = false;
    document.querySelector<HTMLButtonElement>("[data-cart-clear-confirm]")?.focus();
}

function hideClearConfirmation() {
    const confirm = byId<HTMLElement>("cart-clear-confirm");
    if (confirm) confirm.hidden = true;
    document.querySelector<HTMLButtonElement>("[data-cart-clear]:not([hidden])")?.focus();
}

function finishOrder() {
    lines = [];
    saveCart();
    savePending(null);
    showSuccess = false;
    const note = byId<HTMLTextAreaElement>("order-note");
    if (note) note.value = "";
    render();
    closeCart();
}

/* ---------- customer details ---------- */

function saveCustomer(details: Record<string, string>) {
    try {
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ ...details, mode }));
    } catch {
        /* ignore */
    }
}

/** Remember just the pickup/delivery choice (the other details are saved when an order is sent). */
function persistMode() {
    try {
        const saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? "{}") ?? {};
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ ...saved, mode }));
    } catch {
        /* ignore */
    }
}

function prefillCustomer() {
    try {
        const saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? "null");
        if (!saved) return;
        const fill = (id: string, value: unknown, max: number) => {
            const el = byId<HTMLInputElement | HTMLTextAreaElement>(id);
            if (el && !el.value) el.value = String(value ?? "").slice(0, max);
        };
        fill("order-name", saved.name, 60);
        fill("order-phone", saved.phone, 20);
        setMode(saved.mode === "delivery" ? "delivery" : "pickup");
    } catch {
        /* ignore */
    }
}

/* ---------- dialog ---------- */

function openCart() {
    const dlg = byId<HTMLDialogElement>("cart-dialog");
    if (!dlg || dlg.open) return;
    prefillCustomer();
    clearError();
    render();
    dlg.showModal();
}

function closeCart() {
    const dlg = byId<HTMLDialogElement>("cart-dialog");
    hideClearConfirmation();
    if (showSuccess) markDismissed();
    if (dlg?.open) dlg.close();
}

/* ---------- sending the order ---------- */

function clearError() {
    show("cart-error", false);
    document.querySelectorAll("#order-form [aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

function fail(el: HTMLElement | null, message: string) {
    const box = byId("cart-error");
    if (box) {
        box.textContent = message;
        box.hidden = false;
    }
    if (el) {
        el.setAttribute("aria-invalid", "true");
        el.focus();
    }
}

async function handleSend() {
    const cat = getCatalog();
    const rows = resolve();
    if (!cat || rows.length === 0 || sending) return;

    const nameEl = byId<HTMLInputElement>("order-name");
    const phoneEl = byId<HTMLInputElement>("order-phone");
    const noteEl = byId<HTMLTextAreaElement>("order-note");
    if (!nameEl || !phoneEl || !noteEl) return;

    clearError();

    const name = nameEl.value.trim().replace(/\s+/g, " ");
    const phone = phoneEl.value.trim();
    if (name.length < 2) return fail(nameEl, "Please enter your name.");
    if (!isValidPhone(phone)) {
        return fail(phoneEl, "Please enter a valid phone number, like 024 123 4567.");
    }

    const note = noteEl.value.trim().replace(/\s+/g, " ").slice(0, 200);
    const order = buildOrder({
        ref: makeOrderRef(),
        mode,
        name,
        phone,
        note,
        lines: rows.map(({ line, item, opt, extras }) => ({
            id: item.id,
            name: item.name,
            sizeKey: opt.k,
            sizeLabel: opt.label,
            unitPrice: opt.price,
            qty: line.q,
            // each ticked extra applies to every drink on the line
            addons: extras.map((e) => ({ id: e.k, name: e.name, price: e.price, qty: line.q })),
        })),
    });

    saveCustomer({ name, phone });

    // WhatsApp opens inside this tap: the transport runs synchronously until its first await
    sending = true;
    const result = await sendOrder(order, getTransport(cat.ordering.mode, { whatsappNumber: cat.whatsapp }));
    sending = false;
    if (!result.ok) return fail(null, result.error);

    // We can't tell whether the customer actually taps "Send" inside WhatsApp, so the cart is
    // kept until they confirm they sent it. The pending order is remembered so the confirmation
    // is still there when they come back, even if the page reloaded.
    const pending: Pending = { ref: order.ref, mode, total: order.total, url: result.reopenUrl, at: Date.now() };
    savePending(pending);
    showSuccess = true;
    fillConfirmation(pending);
    render();
    byId("cart-title")?.focus();
}

/* ---------- wiring (document-level, so it survives page transitions) ---------- */

document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;

    const add = t.closest<HTMLElement>("[data-add]");
    if (add) {
        addItem(add.dataset.id ?? "", add.dataset.opt ?? "");
        pop(add);
        return;
    }

    const step = t.closest<HTMLElement>("[data-qty]");
    if (step) return changeQty(step.dataset.id ?? "", step.dataset.k ?? "", step.dataset.x ?? "", Number(step.dataset.qty));

    if (t.closest("[data-cart-open]")) return openCart();
    if (t.closest("[data-cart-clear]")) return showClearConfirmation();
    if (t.closest("[data-cart-clear-cancel]")) return hideClearConfirmation();
    if (t.closest("[data-cart-clear-confirm]")) {
        hideClearConfirmation();
        return clearCart();
    }
    if (t.closest("[data-cart-done]")) return finishOrder();
    if (t.closest("[data-cart-back]")) {
        savePending(null);
        showSuccess = false;
        render();
        return;
    }
    // Clicks on the dimmed backdrop land on the <dialog> itself
    if (t.closest("[data-cart-close]") || t === byId("cart-dialog")) closeCart();
});

// The item sheet (src/scripts/item-sheet.ts) hands over its choice as an event
document.addEventListener("luna:add-item", (e) => {
    const d = (e as CustomEvent<{ id?: string; k?: string; qty?: number; x?: string[] }>).detail;
    if (d?.id && d.k) addItem(d.id, d.k, d.qty ?? 1, d.x ?? []);
});

// Pickup / delivery switch and delivery area
document.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement | null;
    if (!t) return;
    if (t.name === "mode") {
        setMode(t.value === "delivery" ? "delivery" : "pickup");
        persistMode();
        clearError();
        render();
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !byId<HTMLElement>("cart-clear-confirm")?.hidden) {
        hideClearConfirmation();
    }
});

document.addEventListener("submit", (e) => {
    if ((e.target as HTMLElement | null)?.id === "order-form") {
        e.preventDefault();
        handleSend();
    }
});

// Keep several open tabs in step
window.addEventListener("storage", (e) => {
    if (e.key === CART_KEY) {
        loadCart();
        render();
    }
});

function init() {
    loadCart();
    prefillCustomer();
    render();
    restoreConfirmation();
}

// Coming back to this tab (for example from WhatsApp): make sure the confirmation is showing
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") restoreConfirmation();
});

// Closing the order panel by any route (×, backdrop, Escape) counts as dismissing the confirmation
// ("close" doesn't bubble, so listen in the capture phase)
document.addEventListener(
    "close",
    (e) => {
        if ((e.target as HTMLElement | null)?.id === "cart-dialog" && showSuccess) markDismissed();
    },
    true,
);

document.addEventListener("astro:page-load", init);
document.addEventListener("astro:before-swap", () => {
    if (showSuccess) markDismissed(); // leaving the page on purpose: don't pop the confirmation open on the next one
    byId<HTMLDialogElement>("cart-dialog")?.close();
    showSuccess = false;
});
init();
