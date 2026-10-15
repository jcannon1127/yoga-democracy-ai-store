import { HttpTypes } from "@medusajs/types"

/**
 * Two separate questions, deliberately not collapsed into one:
 *
 *   1. **Do we have it?**  -> `getAvailability`  (a claim about stock)
 *   2. **Can they buy it?** -> `isOrderable`     (a claim about policy)
 *
 * These used to be the same function, with backorderable variants reported as `in-stock`.
 * That was safe while nothing was backorderable. It stopped being safe the moment
 * `allow_backorder` was turned on across the catalogue: 2,370 of 3,738 variants are now
 * backorderable, so a size sitting at a confirmed **zero** would have rendered "In Stock".
 * That is not a display quirk — it is the page stating, in words, that YD is holding stock
 * it is not holding, on a page whose whole job is to be trusted about that.
 *
 * Keeping them apart lets the page do the thing that is both honest and commercial: say the
 * size is on backorder, and sell it anyway.
 *
 * Stock is three-state, not two. `inventory_quantity: null` or an unmanaged variant means
 * the SKU has no inventory record — "we have no figure", which is not "we have none".
 * Roughly a third of the catalogue is in that state, and it is not a rounding error:
 * measured against the live site, **12.9% of those SKUs are on sale right now** (yd-alloc,
 * full catalogue; I measured 17.5% on a 45-product sample). Rendering them as sold out
 * would silently block real, sellable garments.
 */
export type Availability = "in-stock" | "out-of-stock" | "unknown"

/**
 * What we know about stock, and only that. Ignores `allow_backorder` on purpose — being
 * willing to sell something is not the same as having it.
 */
export const getAvailability = (
  variant?: HttpTypes.StoreProductVariant
): Availability => {
  if (!variant) return "unknown"

  // Unmanaged — Medusa tracks no inventory for this SKU, so we have no figure to report.
  if (!variant.manage_inventory) return "unknown"

  // Managed but the quantity did not come back: also unknown, not zero. (This is what the
  // whole catalogue looks like whenever Medusa refuses inventory — see the sales-channel
  // fault on 2026-08-22. The page must degrade to "we don't know", never to "sold out".)
  if (variant.inventory_quantity == null) return "unknown"

  return variant.inventory_quantity > 0 ? "in-stock" : "out-of-stock"
}

/**
 * Whether the customer may actually add it to the cart.
 *
 * Mirrors what Medusa itself will accept, so the page never offers something checkout then
 * refuses — and never blocks something checkout would have taken. A confirmed zero is only
 * a dead end when backorders are off for that variant.
 */
export const isOrderable = (variant?: HttpTypes.StoreProductVariant): boolean => {
  if (!variant) return false
  if (variant.allow_backorder) return true
  if (!variant.manage_inventory) return true
  if (variant.inventory_quantity == null) return true
  return variant.inventory_quantity > 0
}

/**
 * True when we know there is none AND it cannot be ordered anyway — the only case that
 * justifies greying a size out. Unknown never qualifies.
 */
export const isUnavailable = (variant?: HttpTypes.StoreProductVariant): boolean =>
  getAvailability(variant) === "out-of-stock" && !isOrderable(variant)

/** Knowingly selling from zero: orderable, but we do not have it on the shelf. */
export const isBackorder = (variant?: HttpTypes.StoreProductVariant): boolean =>
  getAvailability(variant) === "out-of-stock" && isOrderable(variant)
