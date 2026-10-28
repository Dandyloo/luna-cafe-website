// src/scripts/cart.ts
// WhatsApp-first ordering cart (pickup or delivery). Everything runs in the browser, with no backend.
//
// - The cart is stored in localStorage as {id, option, qty} only. Names and prices always
//   come from the menu catalog embedded in the page (#menu-data, see CartDrawer.astro),
//   so a stale or edited cart can never change what something costs.
// - "Send" builds a structured message and opens WhatsApp with it pre-filled.
// - Later, the same order object can be POSTed to a backend instead (staff dashboard).

type Option = { k: string; label: string; price: number };
type Item = { id: string; name: string; options: Option[] };
type HoursRule = { days: number[]; open: number; close: number };
type Delivery = { enabled: boolean };
type Catalog = { whatsapp: string; hours: HoursRule[]; delivery: Delivery; items: Item[] };
type Line = { id: string; k: string; q: number };
type Resolved = { line: Line; item: Item; opt: Option };
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
        catalog = parsed;
        index = new Map(catalog.items.map((i) => [i.id, i]));
    } catch {
        return null;
    }
    return catalog;
}

const deliveryEnabled = () => !!getCatalog()?.delivery.enabled;

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
            const dup = lines.find((l) => l.id === item.id && l.k === opt.k);
            if (dup) dup.q = Math.min(MAX_QTY, dup.q + q);
            else if (lines.length < MAX_LINES) lines.push({ id: item.id, k: opt.k, q });
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
        if (item && opt) out.push({ line, item, opt });
    }
    return out;
}

/* ---------- pickup / delivery ---------- */

/** Delivery fee is never calculated on the site: Luna confirms it on WhatsApp. */
function deliveryFee(): { known: boolean; fee: number } {
    return mode === "delivery" ? { known: false, fee: 0 } : { known: true, fee: 0 };
}

function setMode(next: Mode) {
    mode = next === "delivery" && deliveryEnabled() ? "delivery" : "pickup";
}

function renderMode() {
    const del = mode === "delivery";
    const radio = byId<HTMLInputElement>(del ? "mode-delivery" : "mode-pickup");
    if (radio && !radio.checked) radio.checked = true;

    show("cart-delivery-row", del);
    setText(
        "mode-note",
        del
            ? "No address needed. Our rider will call you to ask where you are, and we'll confirm the delivery fee on WhatsApp."
            : "We'll notify you on WhatsApp when your order is ready for pickup.",
    );
    setText(
        "cart-pay-note",
        del
            ? "Pay when your order arrives. We confirm every order on WhatsApp."
            : "Pay when you pick up. We confirm every order on WhatsApp.",
    );
    setText("cart-submit-label", del ? "Send delivery order on WhatsApp" : "Send pickup order on WhatsApp");
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
        "grid h-9 w-9 place-items-center rounded-full bg-brand-shadow/10 text-brand-shadow transition hover:bg-brand-primary active:scale-90 disabled:opacity-40",
    );
    // Drawn as an icon (not a text glyph) so the sign sits exactly in the middle of the circle
    b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="${STEP_ICONS[text] ?? STEP_ICONS["+"]}"/></svg>`;
    b.type = "button";
    b.dataset.qty = String(delta);
    b.dataset.id = line.id;
    b.dataset.k = line.k;
    b.setAttribute("aria-label", aria);
    if (delta > 0 && line.q >= MAX_QTY) b.disabled = true;
    return b;
}

function lineRow({ line, item, opt }: Resolved) {
    const label = item.name + (opt.label ? ` ${opt.label}` : "");
    const li = h("li", "flex items-center gap-3 py-3.5");

    const info = h("div", "min-w-0 flex-1");
    info.append(
        h("p", "font-semibold leading-snug text-brand-text", item.name),
        h("p", "text-sm text-brand-text/60", [opt.label, money(opt.price)].filter(Boolean).join(" · ")),
    );

    const stepper = h("div", "flex items-center gap-1");
    stepper.append(
        stepButton(line, -1, line.q === 1 ? `Remove ${label}` : `One less ${label}`, line.q === 1 ? "×" : "−"),
        h("span", "w-7 text-center font-bold", String(line.q)),
        stepButton(line, 1, `One more ${label}`, "+"),
    );

    li.append(info, stepper, h("p", "w-20 text-right font-bold text-brand-shadow", money(line.q * opt.price)));
    return li;
}

function render() {
    if (!getCatalog()) return;
    const rows = resolve();
    const count = rows.reduce((n, r) => n + r.line.q, 0);
    const subtotal = rows.reduce((n, r) => n + r.line.q * r.opt.price, 0);
    const { known, fee } = deliveryFee();
    const total = subtotal + fee;
    const del = mode === "delivery";

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
    setText("cart-delivery-fee", known ? (fee === 0 ? "Free" : money(fee)) : "Confirmed on WhatsApp");
    setText("cart-total", money(total));
    show("cart-total-note", del && !known);

    const closed = closedMessage();
    setText("cart-closed", closed ?? "");
    show("cart-closed", !!closed && count > 0 && !showSuccess);

    const list = byId("cart-lines");
    if (!list) return;

    // Keep keyboard focus on the same stepper button after the list is rebuilt
    const active = document.activeElement as HTMLElement | null;
    const key = active?.dataset?.qty ? `${active.dataset.id}|${active.dataset.k}|${active.dataset.qty}` : null;
    list.replaceChildren(...rows.map(lineRow));
    if (key) {
        const next = Array.from(list.querySelectorAll<HTMLButtonElement>("[data-qty]")).find(
            (b) => `${b.dataset.id}|${b.dataset.k}|${b.dataset.qty}` === key && !b.disabled,
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

function addItem(id: string, k: string, qty = 1) {
    const item = index.get(id);
    const opt = item?.options.find((o) => o.k === k);
    if (!item || !opt) return;
    const label = item.name + (opt.label ? ` (${opt.label})` : "");
    const want = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(qty)) || 1));
    let added = want;

    const existing = lines.find((l) => l.id === id && l.k === k);
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
        lines.push({ id, k, q: want });
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

function changeQty(id: string, k: string, delta: number) {
    const line = lines.find((l) => l.id === id && l.k === k);
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

function makeRef() {
    // No look-alike characters (0/O, 1/I), so it's easy to read out over the counter
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return "LN-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Opens WhatsApp from the submit gesture. A real link click is more reliable than window.open
 * (popup blockers, in-app browsers, and the Cross-Origin-Opener-Policy header all interfere with
 * window.open). If the browser still blocks it, the success screen has an "Open WhatsApp again" link.
 */
function openWhatsApp(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
}

function handleSend() {
    const cat = getCatalog();
    const rows = resolve();
    if (!cat || rows.length === 0) return;

    const nameEl = byId<HTMLInputElement>("order-name");
    const phoneEl = byId<HTMLInputElement>("order-phone");
    const noteEl = byId<HTMLTextAreaElement>("order-note");
    if (!nameEl || !phoneEl || !noteEl) return;

    clearError();
    const delivery = mode === "delivery";

    const name = nameEl.value.trim().replace(/\s+/g, " ");
    const phone = phoneEl.value.trim();
    if (name.length < 2) return fail(nameEl, "Please enter your name.");
    // Ghana numbers: 0XXXXXXXXX, or +233 / 233 followed by 9 digits
    if (!/^(?:\+?233|0)\d{9}$/.test(phone.replace(/[\s().-]/g, ""))) {
        return fail(phoneEl, "Please enter a valid phone number, like 024 123 4567.");
    }

    const note = noteEl.value.trim().replace(/\s+/g, " ").slice(0, 200);
    const subtotal = rows.reduce((n, r) => n + r.line.q * r.opt.price, 0);
    const { known, fee } = deliveryFee();
    const total = subtotal + fee;
    const ref = makeRef();

    const feeText = known ? (fee === 0 ? "Free" : money(fee)) : "to be confirmed";
    const message = [
        "Hi Luna! I'd like to place an order from your website.",
        "",
        `*Order ${ref}*`,
        delivery ? "*Delivery* (rider will call me for my location)" : "*Pickup* (please message me when it's ready)",
        `Name: ${name}`,
        `Phone: ${phone}`,
        "",
        ...rows.map(
            ({ line, item, opt }) =>
                `- ${line.q} x ${item.name}${opt.label ? ` (${opt.label})` : ""} - ${money(line.q * opt.price)}`,
        ),
        "",
        ...(delivery
            ? [`Subtotal: ${money(subtotal)}`, `Delivery fee: ${feeText}`]
            : []),
        delivery && !known ? `*Items total: ${money(subtotal)}* (+ delivery fee)` : `*Total: ${money(total)}*`,
        ...(note ? [`Note: ${note}`] : []),
        `Payment: on ${delivery ? "delivery" : "pickup"}`,
    ].join("\n");

    const url = `https://wa.me/${cat.whatsapp}?text=${encodeURIComponent(message)}`;

    saveCustomer({ name, phone });

    openWhatsApp(url);

    // We can't tell whether the customer actually taps "Send" inside WhatsApp, so the cart is
    // kept until they confirm they sent it.
    showSuccess = true;
    setText("cart-ref", ref);
    setText("cart-success-type", delivery ? "Delivery" : "Pickup");
    setText(
        "cart-success-total",
        delivery && !known ? `${money(subtotal)} + delivery fee` : money(total),
    );
    setText(
        "cart-success-next",
        delivery
            ? "Our rider will call you for your location, and we confirm the delivery fee."
            : "We message you when it's ready for pickup.",
    );
    const link = byId<HTMLAnchorElement>("cart-wa-link");
    if (link) link.href = url;
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
    if (step) return changeQty(step.dataset.id ?? "", step.dataset.k ?? "", Number(step.dataset.qty));

    if (t.closest("[data-cart-open]")) return openCart();
    if (t.closest("[data-cart-clear]")) return showClearConfirmation();
    if (t.closest("[data-cart-clear-cancel]")) return hideClearConfirmation();
    if (t.closest("[data-cart-clear-confirm]")) {
        hideClearConfirmation();
        return clearCart();
    }
    if (t.closest("[data-cart-done]")) return finishOrder();
    if (t.closest("[data-cart-back]")) {
        showSuccess = false;
        render();
        return;
    }
    // Clicks on the dimmed backdrop land on the <dialog> itself
    if (t.closest("[data-cart-close]") || t === byId("cart-dialog")) closeCart();
});

// The item sheet (src/scripts/item-sheet.ts) hands over its choice as an event
document.addEventListener("luna:add-item", (e) => {
    const d = (e as CustomEvent<{ id?: string; k?: string; qty?: number }>).detail;
    if (d?.id && d.k) addItem(d.id, d.k, d.qty ?? 1);
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
}

document.addEventListener("astro:page-load", init);
document.addEventListener("astro:before-swap", () => {
    byId<HTMLDialogElement>("cart-dialog")?.close();
    showSuccess = false;
});
init();
