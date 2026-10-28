// src/lib/order.ts
// The Order: one plain object that describes what a customer ordered, independent of the screen
// it came from. The website cart builds it today. A staff orders panel or a mobile app can build,
// store or receive the exact same shape later. No DOM or browser-only code lives here apart from
// makeOrderRef (crypto), so it can be reused anywhere.

export type OrderMode = "pickup" | "delivery";

/** An extra added to a line (planned for phase 2: extra boba, popping, cheese foam...). */
export type OrderAddon = { id: string; name: string; price: number; qty: number };

export type OrderLine = {
    /** Menu item id ("<group>--<item>"), the same id the menu and cart use. */
    id: string;
    name: string;
    /** Size key and label, e.g. "L" / "700ml". Empty label for single-size items. */
    sizeKey: string;
    sizeLabel: string;
    unitPrice: number;
    qty: number;
    addons?: OrderAddon[];
    /** Optional per-item note (planned for phase 2). */
    note?: string;
    /** unitPrice x qty, plus add-ons. Always computed by buildOrder. */
    lineTotal: number;
};

export type Order = {
    /** Short, readable reference the customer can quote, e.g. "LN-7K4P". */
    ref: string;
    createdAt: string; // ISO 8601
    source: "website";
    mode: OrderMode;
    customer: { name: string; phone: string };
    /** Whole-order note from the customer. Empty string when none. */
    note: string;
    lines: OrderLine[];
    currency: "GHS";
    /** Items total. Payment and delivery fees are handled by Luna after contacting the customer. */
    total: number;
};

export type OrderInput = {
    ref: string;
    mode: OrderMode;
    name: string;
    phone: string;
    note?: string;
    lines: Array<Omit<OrderLine, "lineTotal">>;
};

export const formatMoney = (n: number) => `GHS ${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Builds a complete Order and computes every total, so callers can't get the maths wrong. */
export function buildOrder(input: OrderInput): Order {
    const lines: OrderLine[] = input.lines.map((l) => {
        const addons = l.addons?.filter((a) => a.qty > 0);
        const addonsTotal = (addons ?? []).reduce((n, a) => n + a.price * a.qty, 0);
        return { ...l, addons: addons?.length ? addons : undefined, lineTotal: l.unitPrice * l.qty + addonsTotal };
    });
    return {
        ref: input.ref,
        createdAt: new Date().toISOString(),
        source: "website",
        mode: input.mode,
        customer: { name: input.name, phone: input.phone },
        note: input.note ?? "",
        lines,
        currency: "GHS",
        total: lines.reduce((n, l) => n + l.lineTotal, 0),
    };
}

/** No look-alike characters (0/O, 1/I), so it's easy to read out over the counter. */
export function makeOrderRef(): string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return "LN-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Ghana numbers: 0XXXXXXXXX, or +233 / 233 followed by 9 digits. */
export function isValidPhone(phone: string): boolean {
    return /^(?:\+?233|0)\d{9}$/.test(phone.trim().replace(/[\s().-]/g, ""));
}

/**
 * The WhatsApp message Luna receives. Same layout for pickup and delivery; no payment or
 * delivery-fee lines, because Luna contacts the customer afterwards.
 */
export function formatWhatsAppMessage(order: Order): string {
    const delivery = order.mode === "delivery";
    const itemLines = order.lines.flatMap((l) => {
        const label = l.sizeLabel ? ` (${l.sizeLabel})` : "";
        return [
            `\u2022 ${l.qty} x ${l.name}${label} - ${formatMoney(l.unitPrice * l.qty)}`,
            ...(l.addons ?? []).map((a) => `   + ${a.qty > 1 ? `${a.qty} x ` : ""}${a.name} - ${formatMoney(a.price * a.qty)}`),
            ...(l.note ? [`   Note: ${l.note}`] : []),
        ];
    });

    return [
        "Hi Luna! I'd like to place an order from your website.",
        "",
        `\u{1F9FE} *ORDER ${order.ref}*`,
        delivery ? "\u{1F6F5} *Delivery*" : "\u{1F6CD}\uFE0F *Pickup*",
        ...(delivery ? ["\u{1F4CD} Please have the rider call me for my location."] : []),
        "",
        `\u{1F464} ${order.customer.name}`,
        `\u{1F4DE} ${order.customer.phone}`,
        "",
        "*Items*",
        ...itemLines,
        ...(order.note ? ["", `\u{1F4DD} Note: ${order.note}`] : []),
        "",
        `*Total: ${formatMoney(order.total)}*`,
        "",
        "Please confirm my order. Thank you!",
    ].join("\n");
}
