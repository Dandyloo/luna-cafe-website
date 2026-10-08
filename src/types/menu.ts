export type MenuItemBase = {
    name: string;
    description?: string;
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