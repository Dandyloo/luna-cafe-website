// src/lib/config.ts
// Business details used by the ordering flow. Change them here, not in components.

/** WhatsApp number in international format, digits only (no "+"). */
export const WHATSAPP_NUMBER = "233593676875";

/**
 * Opening hours used by the ordering flow (pickup times and the "we're closed" notice).
 * Minutes after midnight in Africa/Accra time (GMT, no daylight saving).
 * days: 0 = Sunday ... 6 = Saturday.
 * Keep in sync with the hours shown in BaseLayout and the About page.
 */
export const HOURS = [
    { days: [1, 2, 3, 4], open: 8 * 60, close: 22 * 60 }, // Mon–Thu 8:00–22:00
    { days: [5, 6, 0], open: 8 * 60, close: 23 * 60 }, // Fri–Sun 8:00–23:00
];
