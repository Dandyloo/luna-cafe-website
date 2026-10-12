// src/lib/menu.ts
// Turns menu.json into something orderable: stable item ids + a flat list of size/price options.
import type { MenuData } from "../types/menu";

export type Option = { k: string; label: string; price: number };

export type CatalogItem = {
    id: string;
    name: string;
    available: boolean;
    options: Option[];
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
                out.push({ id, name: item.name, available: item.available !== false, options });
            }
        }
    }
    return out;
}
