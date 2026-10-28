// src/lib/transport.ts
// Where a finished Order goes. The cart builds an Order and calls sendOrder(order, transport);
// it never needs to know whether that means WhatsApp, an orders API for the staff panel, or an app.
//
// Today only "whatsapp" is live. To add the orders panel later: write an apiTransport() that
// POSTs the Order as JSON and returns { ok: true }, then add it in getTransport() below and set
// ORDERING.mode in src/lib/config.ts. Nothing else in the cart has to change.

import { formatWhatsAppMessage, type Order } from "./order";

/** whatsapp: send via WhatsApp (live). api: send to the orders panel backend (later). app-only: ordering lives in the app (later). */
export type OrderingMode = "whatsapp" | "api" | "app-only";

export type SendResult =
    | { ok: true; /** A link to try again if the browser blocked the first attempt. */ reopenUrl?: string }
    | { ok: false; error: string };

export type OrderTransport = {
    name: string;
    send(order: Order): SendResult | Promise<SendResult>;
};

/**
 * Opens WhatsApp from the tap that submitted the order. A real link click is more reliable than
 * window.open (popup blockers, in-app browsers, and the Cross-Origin-Opener-Policy header all
 * interfere with window.open). If the browser still blocks it, the caller shows `reopenUrl`.
 */
function openLink(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
}

export function whatsappUrl(number: string, order: Order): string {
    return `https://wa.me/${number}?text=${encodeURIComponent(formatWhatsAppMessage(order))}`;
}

export function whatsappTransport(number: string): OrderTransport {
    return {
        name: "whatsapp",
        send(order) {
            const url = whatsappUrl(number, order);
            openLink(url);
            // We can't tell whether the customer taps "Send" inside WhatsApp, so the caller keeps the cart until they confirm.
            return { ok: true, reopenUrl: url };
        },
    };
}

export function getTransport(mode: OrderingMode, opts: { whatsappNumber: string }): OrderTransport {
    if (mode === "whatsapp") return whatsappTransport(opts.whatsappNumber);
    return {
        name: mode,
        send: () => ({
            ok: false,
            error: "Online ordering isn't available right now. Please message us on WhatsApp.",
        }),
    };
}

/** Sends an order and never throws: failures come back as { ok: false, error }. */
export async function sendOrder(order: Order, transport: OrderTransport): Promise<SendResult> {
    try {
        // transport.send runs synchronously up to here, so WhatsApp still opens inside the customer's tap
        return await transport.send(order);
    } catch {
        return { ok: false, error: "We couldn't send your order. Please try again, or message us on WhatsApp." };
    }
}
