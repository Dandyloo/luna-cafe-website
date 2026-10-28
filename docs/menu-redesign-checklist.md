# Menu redesign checklist

Goal: app-style menu (tiles, item sheet with sizes, order bar), orders still go to WhatsApp.
The WhatsApp message format does not change in these steps. Do one step at a time.

## Phase 1: redesign

- [x] 1. Foundations in `src/lib/menu.ts`: clean group titles, "from" price, optional `image` field
- [x] 2. Menu page: tile rows, sticky category chips with smooth horizontal scroll (scroll-spy)
- [x] 3. Item sheet (`ItemSheet.astro` + `src/scripts/item-sheet.ts`): native dialog, size cards, quantity, live "Add" button
      (built and rendered on /menu; opens via `[data-open-item]` or `luna:open-item`, adds via `luna:add-item`. Nothing triggers it until step 4)
- [x] 4. Wire `cart.ts`: open item on tap, quick-add for single-size items, `addItem(id, k, qty)`
      (whole tile opens the sheet; single-size `+` still adds directly; temporary size buttons removed;
      visible "added" feedback comes with the order bar in step 5)
- [x] 5. Order bar: replace the floating button with a bottom bar (count + total)
      (same `#cart-fab` ids, so cart.ts drives it; slides up, pulses on add; page gets bottom padding while it shows;
      +/− signs are SVG icons so they sit dead-centre in their circles)
- [x] 6. Deep links: `?item=<id>` opens the sheet, back button closes it
      (in `src/scripts/item-sheet.ts`; the popstate handler claims our own history entries so the page router doesn't re-render)
- [x] 7. Desktop: category rail, two-column grid, centered modal
      (rail replaces the chip bar at `lg` and up; chips stay on phones/tablets; item sheet is a centered modal from `sm` up)
- [~] 8. QA: extend `scripts/qa-check.mjs`, check SEO (items still in server HTML), keyboard and screen reader
      Done: qa-check.mjs now checks tiles (server-rendered), chips/rail targets, item sheet markup, order bar on every page.
      STILL TO DO (needs a real browser, not run yet): `npm run qa`, then the manual checks below, then tick this box.

### Manual checks (phone width, then desktop)
- [ ] Tap a multi-size item, pick 700ml, qty 2, Add: order drawer shows the right line and total
- [ ] Tap `+` on a single-size item: adds straight away, order bar slides up and pulses
- [ ] Sheet closes with ×, backdrop tap, Escape; back button closes it; URL returns to /menu
- [ ] Paste /menu?item=<id> in a new tab: that item's sheet opens
- [ ] Chips scroll sideways smoothly, active chip follows the page, tapping a chip glides to its section
- [ ] Desktop (1024px+): rail highlights the current group; chips are hidden
- [ ] Search "coffee": chips/rail and empty groups hide, clearing it brings them back
- [ ] Keyboard only: Tab to an item name, Enter opens the sheet, Tab order is sensible, Escape closes
- [ ] Send a test order: WhatsApp message text is unchanged from before the redesign
- [ ] Other pages (home, about): order bar shows when the cart has items, page bottom not covered

## Phase 2: richer ordering
- [ ] Extras as add-ons inside boba items
- [ ] Per-item notes
- [ ] Badges (Popular, New)

## Phase 3: transport seam
- [ ] Pure order logic into `src/lib/`, `Order` type, `sendOrder(order)` with a WhatsApp transport
- [ ] Normalize price fields into a `sizes` list in the data
- [ ] `ORDERING.mode` flag in `config.ts`
