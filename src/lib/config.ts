// src/lib/config.ts
// Business details used by the ordering flow. Change them here, not in components.

import type { OrderingMode } from "./transport";

/** WhatsApp number in international format, digits only (no "+"). */
export const WHATSAPP_NUMBER = "233593676875";

/**
 * Opening hours are embedded in the ordering catalog so the cart can warn customers
 * when Luna is closed. Minutes after midnight in Africa/Accra time (GMT, no daylight saving).
 * Days: 0 = Sunday ... 6 = Saturday.
 */
export const HOURS = [
  { days: [1, 2, 3, 4], open: 8 * 60, close: 22 * 60 },
  { days: [5, 6, 0], open: 8 * 60, close: 23 * 60 },
];

/**
 * Where finished orders go (see src/lib/transport.ts).
 * "whatsapp": the order opens in WhatsApp (live today).
 * "api" / "app-only": reserved for the staff orders panel and the mobile app.
 */
export const ORDERING: { mode: OrderingMode } = {
  mode: "whatsapp",
};

/**
 * Delivery settings.
 * Delivery has no address field: the order goes to WhatsApp labelled "Delivery", the rider
 * calls the customer for their location, and Luna confirms the delivery fee on WhatsApp.
 * Set enabled to false to hide the Pickup / Delivery switch and go back to pickup only.
 */
export const DELIVERY: { enabled: boolean } = {
  enabled: true,
};
