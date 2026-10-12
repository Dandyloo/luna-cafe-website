// src/scripts/cart.ts
// WhatsApp-first ordering cart. Everything runs in the browser, with no backend.
//
// - The cart is stored in localStorage as {id, option, qty} only. Names and prices always
//   come from the menu catalog embedded in the page (#menu-data, see CartDrawer.astro),
//   so a stale or edited cart can never change what something costs.
// - "Send" builds a structured message and opens WhatsApp with it pre-filled.
// - Later, the same order object can be POSTed to a backend instead (staff dashboard).

type Option = { k: string; label: string; price: number };
type Item = { id: string; name: string; options: Option[] };
type HoursRule = { days: number[]; open: number; close: number };
type Catalog = { whatsapp: string; hours: HoursRule[]; items: Item[] };
type Line = { id: string; k: string; q: number };
type Resolved = { line: Line; item: Item; opt: Option };

const CART_KEY = "luna-cart-v1";
const CUSTOMER_KEY = "luna-customer-v1";
const MAX_QTY = 20;
const MAX_LINES = 30;
const TZ = "Africa/Accra";
const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let catalog: Catalog | null = null;
let index = new Map<string, Item>();
let lines: Line[] = [];
let showSuccess = false;
let lastOrder: { ref: string; url: string } | null = null;

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

/* ---------- catalog + storage ---------- */

function getCatalog(): Catalog | null {
    if (catalog) return catalog;
    const raw = byId("menu-data")?.textContent;
    if (!raw) return null;
    try {
        catalog = JSON.parse(raw) as Catalog;
        index = new Map(catalog.items.map((i) => [i.id, i]));
    } catch {
        return null;
    }
    return catalog;
}

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

/* ---------- opening hours / pickup time (always Africa/Accra time) ---------- */

function accraNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
    return {
        day: DAYS[get("weekday")] ?? 0,
        minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
    };
}

function pickupWindow() {
    const cat = getCatalog()!;
    const now = accraNow();
    const rule = cat.hours.find((r) => r.days.includes(now.day));
    const isOpen = !!rule && now.minutes >= rule.open && now.minutes < rule.close;
    let min = 0;
    let max = -1;
    if (rule && now.minutes < rule.close) {
        const earliest = isOpen ? now.minutes + 15 : rule.open;
        min = Math.ceil(Math.max(rule.open, earliest) / 5) * 5;
        max = rule.close - 15;
    }
    return { isOpen, canLater: min <= max, min, max };
}

const toHHMM = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const toMinutes = (hhmm: string) => {
    const [hh, mm] = hhmm.split(":").map(Number);
    return hh * 60 + mm;
};

function fmtTime(m: number) {
    const hh = Math.floor(m / 60);
    return `${hh % 12 || 12}:${String(m % 60).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

function syncPickupMode() {
    const later = byId<HTMLInputElement>("pickup-later");
    const wrap = byId("pickup-time-wrap");
    if (wrap && later) wrap.hidden = !later.checked;
}

function setupPickup() {
    if (!getCatalog()) return;
    const w = pickupWindow();
    const notice = byId("pickup-notice");
    const asap = byId<HTMLInputElement>("pickup-asap");
    const later = byId<HTMLInputElement>("pickup-later");
    const asapLabel = byId("pickup-asap-label");
    const time = byId<HTMLInputElement>("pickup-time");
    const hint = byId("pickup-hint");
    if (!notice || !asap || !later || !asapLabel || !time || !hint) return;

    notice.hidden = w.isOpen;
    notice.textContent = w.isOpen
        ? ""
        : "We're closed right now. You can still send your order and we'll confirm it when we open.";
    asapLabel.textContent = w.isOpen ? "As soon as possible" : "When you open";

    later.disabled = !w.canLater;
    if (w.canLater) {
        time.min = toHHMM(w.min);
        time.max = toHHMM(w.max);
        if (!time.value || toMinutes(time.value) < w.min) time.value = toHHMM(w.min);
        hint.textContent = `Today between ${fmtTime(w.min)} and ${fmtTime(w.max)}.`;
    } else {
        asap.checked = true;
        hint.textContent = "";
    }
    syncPickupMode();
}

/* ---------- rendering ---------- */

function stepButton(line: Line, delta: number, aria: string, text: string) {
    const b = h(
        "button",
        "grid h-9 w-9 place-items-center rounded-full bg-brand-shadow/10 text-lg font-bold text-brand-shadow transition hover:bg-brand-primary active:scale-90 disabled:opacity-40",
        text,
    );
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
    const li = h("li", "flex items-center gap-3 py-3");

    const info = h("div", "min-w-0 flex-1");
    info.append(
        h("p", "font-semibold text-brand-text", item.name),
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
    const total = rows.reduce((n, r) => n + r.line.q * r.opt.price, 0);

    const fab = byId("cart-fab");
    if (fab) {
        fab.hidden = count === 0;
        fab.setAttribute(
            "aria-label",
            `View your order: ${count} ${count === 1 ? "item" : "items"}, ${money(total)}`,
        );
    }
    const fabCount = byId("cart-fab-count");
    if (fabCount) fabCount.textContent = String(count);
    const fabTotal = byId("cart-fab-total");
    if (fabTotal) fabTotal.textContent = money(total);

    show("cart-empty", count === 0 && !showSuccess);
    show("cart-content", count > 0 && !showSuccess);
    show("cart-footer", count > 0 && !showSuccess);
    show("cart-success", showSuccess);
    const totalEl = byId("cart-total");
    if (totalEl) totalEl.textContent = money(total);

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
    fab.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
        { duration: 260, easing: "ease-out" },
    );
}

/* ---------- cart actions ---------- */

function addItem(id: string, k: string) {
    const item = index.get(id);
    const opt = item?.options.find((o) => o.k === k);
    if (!item || !opt) return;
    const label = item.name + (opt.label ? ` (${opt.label})` : "");

    const existing = lines.find((l) => l.id === id && l.k === k);
    if (existing) {
        if (existing.q >= MAX_QTY) {
            announce(`You can order up to ${MAX_QTY} of ${label} online. For bigger orders, please message us on WhatsApp.`);
            return;
        }
        existing.q++;
    } else if (lines.length >= MAX_LINES) {
        announce("That's a big order! Please send this one first, then start another.");
        return;
    } else {
        lines.push({ id, k, q: 1 });
    }
    saveCart();
    render();
    bump();
    announce(`Added ${label} to your order.`);
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
    if (!window.confirm("Remove everything from your order?")) return;
    lines = [];
    saveCart();
    render();
}

function finishOrder() {
    lines = [];
    saveCart();
    showSuccess = false;
    lastOrder = null;
    const note = byId<HTMLTextAreaElement>("order-note");
    if (note) note.value = "";
    render();
    closeCart();
}

/* ---------- dialog ---------- */

function prefillCustomer() {
    try {
        const saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? "null");
        const name = byId<HTMLInputElement>("order-name");
        const phone = byId<HTMLInputElement>("order-phone");
        if (saved && name && !name.value) name.value = String(saved.name ?? "").slice(0, 60);
        if (saved && phone && !phone.value) phone.value = String(saved.phone ?? "").slice(0, 20);
    } catch {
        /* ignore */
    }
}

function openCart() {
    const dlg = byId<HTMLDialogElement>("cart-dialog");
    if (!dlg || dlg.open) return;
    render();
    setupPickup();
    prefillCustomer();
    clearError();
    dlg.showModal();
}

function closeCart() {
    const dlg = byId<HTMLDialogElement>("cart-dialog");
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

function handleSend() {
    const cat = getCatalog();
    const rows = resolve();
    if (!cat || rows.length === 0) return;

    const nameEl = byId<HTMLInputElement>("order-name");
    const phoneEl = byId<HTMLInputElement>("order-phone");
    const noteEl = byId<HTMLTextAreaElement>("order-note");
    const laterEl = byId<HTMLInputElement>("pickup-later");
    const timeEl = byId<HTMLInputElement>("pickup-time");
    if (!nameEl || !phoneEl || !noteEl || !laterEl || !timeEl) return;

    clearError();

    const name = nameEl.value.trim().replace(/\s+/g, " ");
    const phone = phoneEl.value.trim();
    if (name.length < 2) return fail(nameEl, "Please enter your name.");
    // Ghana numbers: 0XXXXXXXXX, or +233 / 233 followed by 9 digits
    if (!/^(?:\+?233|0)\d{9}$/.test(phone.replace(/[\s().-]/g, ""))) {
        return fail(phoneEl, "Please enter a valid phone number, like 024 123 4567.");
    }

    const w = pickupWindow();
    let pickup: string;
    if (laterEl.checked) {
        if (!w.canLater) {
            setupPickup();
            return fail(null, "Pickup later today isn't available right now. We've switched you to the earliest option.");
        }
        const m = timeEl.value ? toMinutes(timeEl.value) : NaN;
        if (!(m >= w.min && m <= w.max)) {
            return fail(timeEl, `Please pick a time between ${fmtTime(w.min)} and ${fmtTime(w.max)}.`);
        }
        pickup = `Today at ${fmtTime(m)}`;
    } else {
        pickup = w.isOpen ? "ASAP" : "When you open";
    }

    const note = noteEl.value.trim().replace(/\s+/g, " ").slice(0, 200);
    const total = rows.reduce((n, r) => n + r.line.q * r.opt.price, 0);
    const ref = makeRef();

    const message = [
        "Hi Luna! I'd like to place an order from your website.",
        "",
        `*Order ${ref}*`,
        `Name: ${name}`,
        `Phone: ${phone}`,
        `Pickup: ${pickup}`,
        "",
        ...rows.map(
            ({ line, item, opt }) =>
                `- ${line.q} x ${item.name}${opt.label ? ` (${opt.label})` : ""} - ${money(line.q * opt.price)}`,
        ),
        "",
        `*Total: ${money(total)}*`,
        ...(note ? [`Note: ${note}`] : []),
        "Payment: on pickup",
    ].join("\n");

    const url = `https://wa.me/${cat.whatsapp}?text=${encodeURIComponent(message)}`;

    try {
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name, phone }));
    } catch {
        /* ignore */
    }

    // We can't tell whether the customer actually taps "Send" inside WhatsApp, so the cart is
    // kept until they confirm they sent it.
    lastOrder = { ref, url };
    showSuccess = true;
    const refEl = byId("cart-ref");
    if (refEl) refEl.textContent = ref;
    const link = byId<HTMLAnchorElement>("cart-wa-link");
    if (link) link.href = url;
    render();
    byId("cart-title")?.focus();
    window.open(url, "_blank", "noopener");
}

/* ---------- wiring (document-level, so it survives page transitions) ---------- */

document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;

    const add = t.closest<HTMLElement>("[data-add]");
    if (add) return addItem(add.dataset.id ?? "", add.dataset.opt ?? "");

    const step = t.closest<HTMLElement>("[data-qty]");
    if (step) return changeQty(step.dataset.id ?? "", step.dataset.k ?? "", Number(step.dataset.qty));

    if (t.closest("[data-cart-open]")) return openCart();
    if (t.closest("[data-cart-clear]")) return clearCart();
    if (t.closest("[data-cart-done]")) return finishOrder();
    if (t.closest("[data-cart-back]")) {
        showSuccess = false;
        render();
        return;
    }
    // Clicks on the dimmed backdrop land on the <dialog> itself
    if (t.closest("[data-cart-close]") || t === byId("cart-dialog")) closeCart();
});

document.addEventListener("submit", (e) => {
    if ((e.target as HTMLElement | null)?.id === "order-form") {
        e.preventDefault();
        handleSend();
    }
});

document.addEventListener("change", (e) => {
    if ((e.target as HTMLElement | null)?.matches?.('input[name="pickup"]')) syncPickupMode();
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
    render();
    prefillCustomer();
    setupPickup();
}

document.addEventListener("astro:page-load", init);
document.addEventListener("astro:before-swap", () => {
    byId<HTMLDialogElement>("cart-dialog")?.close();
    showSuccess = false;
});
init();
