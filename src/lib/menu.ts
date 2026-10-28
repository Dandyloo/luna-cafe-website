// src/lib/menu.ts
// Turns menu.json into something orderable: stable item ids + a flat list of size/price options.
import type { MenuData } from "../types/menu";

export type Option = { k: string; label: string; price: number };

/** An optional add-on (checkbox in the item sheet). k is a stable key made from its name. */
export type Extra = { k: string; name: string; price: number };

export type CatalogItem = {
    id: string;
    name: string;
    available: boolean;
    options: Option[];
    /** Key into the extras sets (see buildExtraSets) when this item can take extras. */
    extraSet?: string;
};

const isPrice = (v: unknown): v is number => typeof v === "number" && v > 0;

export function slug(text: string): string {
    return text
        .toLowerCase()
        .replace(/\(.*?\)/g, "") // "Milk Tea (all 40 / 60)" -> "milk tea", so repricing a group doesn't change ids
        .replace(/&/g, " and ")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Lower-case, accent-free, punctuation-free text for matching: "Sautéed Veg & Mushroom" -> "sauteed veg mushroom".
 * Used both when building the menu page's search text and when reading what the customer types.
 */
export function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Group title for display: "Milk Tea (all 40 / 60)" -> "Milk Tea" (sizes and prices now show on each item and in the item sheet). */
export const displayGroupName = (name: string) =>
    name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim() || name;

/** Lowest price across an item's size options, or null if none. */
export function fromPrice(options: Option[]): number | null {
    return options.length ? Math.min(...options.map((o) => o.price)) : null;
}

/** Short line shown under the item name on the menu: "From GHS 40", "GHS 60", or "700ml only, GHS 60". */
export function priceSummary(options: Option[]): string {
    if (options.length === 0) return "";
    if (options.length === 1) {
        const [o] = options;
        return o.label ? `${o.label} only, GHS ${o.price}` : `GHS ${o.price}`;
    }
    const lowest = fromPrice(options);
    const prices = new Set(options.map((o) => o.price));
    return prices.size === 1 ? `GHS ${lowest}` : `From GHS ${lowest}`;
}

/** First letter, for the placeholder tile shown when an item has no photo. */
export const itemInitial = (name: string) => (name.trim()[0] ?? "").toUpperCase();

/** Stable id for an item: "<group>--<item>". Changes only if the group or item is renamed. */
export const itemId = (groupName: string, itemName: string) =>
    `${slug(groupName)}--${slug(itemName)}`;

/**
 * The size/price choices for an item. Labels match what the menu page shows:
 * 500ml / 700ml for small/large, M / L for medium/large, none for single-price items.
 * A null price means that size isn't offered.
 */
export function optionsFor(item: any): Option[] {
    const out: Option[] = [];
    if (isPrice(item.price)) out.push({ k: "std", label: "", price: item.price });
    if ("priceMedium" in item) {
        if (isPrice(item.priceMedium)) out.push({ k: "m", label: "M", price: item.priceMedium });
        if (isPrice(item.priceLarge)) out.push({ k: "l", label: "L", price: item.priceLarge });
    } else if ("priceSmall" in item || "priceLarge" in item) {
        if (isPrice(item.priceSmall)) out.push({ k: "s", label: "500ml", price: item.priceSmall });
        if (isPrice(item.priceLarge)) out.push({ k: "l", label: "700ml", price: item.priceLarge });
    }
    return out;
}

/** Flat list of every orderable item. Throws at build time if two items end up with the same id. */
export function buildCatalog(menu: MenuData): CatalogItem[] {
    const seen = new Set<string>();
    const out: CatalogItem[] = [];
    for (const category of menu) {
        const extraSet = extrasFor(category).length ? slug(category.name) : undefined;
        for (const group of category.groups) {
            for (const item of group.items as any[]) {
                const options = optionsFor(item);
                if (options.length === 0) continue;
                const id = itemId(group.name, item.name);
                if (seen.has(id)) {
                    throw new Error(
                        `Duplicate menu id "${id}" (${group.name} › ${item.name}). Rename one of the items.`,
                    );
                }
                seen.add(id);
                out.push({ id, name: item.name, available: item.available !== false, options, ...(extraSet ? { extraSet } : {}) });
            }
        }
    }
    return out;
}

/** The extras a category offers (hidden or unpriced ones are left out). */
export function extrasFor(category: { extras?: Array<{ name: string; price: number; available?: boolean }> }): Extra[] {
    const seen = new Set<string>();
    const out: Extra[] = [];
    for (const e of category.extras ?? []) {
        if (e.available === false || !isPrice(e.price)) continue;
        const k = slug(e.name);
        if (!k || seen.has(k)) throw new Error(`Duplicate or empty extra "${e.name}". Rename it.`);
        seen.add(k);
        out.push({ k, name: e.name, price: e.price });
    }
    return out;
}

/** Extras by category, keyed the same way as CatalogItem.extraSet. Sent once instead of repeated on every item. */
export function buildExtraSets(menu: MenuData): Record<string, Extra[]> {
    const sets: Record<string, Extra[]> = {};
    for (const category of menu) {
        const extras = extrasFor(category);
        if (extras.length) sets[slug(category.name)] = extras;
    }
    return sets;
}
