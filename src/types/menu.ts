export type MenuItemBase = {
    name: string;
    description?: string;
    /** Set to false to show "Sold out" and stop the item being ordered online. */
    available?: boolean;
    /** Optional photo, e.g. "/menu/brown-sugar-milk-tea.webp". Items without one show a tinted initial tile. */
    image?: string;
};

export type MenuItemSingle = MenuItemBase & {
    price: number | null;
};

export type MenuItemSmallLarge = MenuItemBase & {
    priceSmall: number | null;
    priceLarge: number | null;
};

export type MenuItemMediumLarge = MenuItemBase & {
    priceMedium: number | null;
    priceLarge: number | null;
};

export type MenuItem =
    | MenuItemSingle
    | MenuItemSmallLarge
    | MenuItemMediumLarge;

export type MenuGroup = {
    name: string;
    items: MenuItem[];
};

export type MenuCategory = {
    name: string;
    groups: MenuGroup[];
};

export type MenuData = MenuCategory[];