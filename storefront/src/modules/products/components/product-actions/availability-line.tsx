import { Availability } from "@lib/util/availability"

/**
 * The "Availability:" row from the live product page, with one state added.
 *
 * SFCC shows exactly two messages — "In Stock", or a red badge reading "This item is
 * currently not available" — plus "Select Styles for Availability" before you have chosen.
 * We keep all three and add two SFCC never has.
 *
 * **Backorder.** 2,370 variants are now backorderable, and YD genuinely sells that way —
 * 1,314 orders are On Order at this moment. The live site cannot express it: a zero there
 * is simply a dead end. Saying "In Stock" for a backorderable zero would be a false stock
 * claim, and disabling it would throw away a sale YD is happy to take. So the page says
 * what is true and lets them buy.
 *
 * **The lead time is Jeff's, not ours, and it lives in content.** The wording originally
 * made no delivery promise, because advertising a shipping date needs a reasonable basis
 * and nobody here had one. Escalated rather than guessed, and on 2026-08-22 Jeff committed
 * to **10-14 days** — YD can make almost anything in Kenya and land it in that window — in
 * his words, "yes I'll stand behind that". So the promise is now on the page, and the text
 * comes from `src/content/site-chrome.json` so it can be corrected the day it stops being
 * true without touching a component.
 *
 * **This is a claim that can go silently false.** Nothing errors if backorders start taking
 * forty days; the page keeps saying 10-14. Handed to yd-features for the detector registry
 * so it has an owner watching real fulfilment time against the promise.
 *
 * **Nothing left to select.** On a product where EVERY variant is unbuyable — 12 of 543 —
 * live still says "Select Styles for Availability" beside a disabled Add to Cart and a size
 * list where nothing can be chosen. **A message that names the wrong cause sends the reader
 * to the wrong place**: it invites a customer to select styles, and selecting is exactly what
 * cannot be done. the catalogue agent lost twenty minutes to the same species of message when a 400
 * blamed a sales channel that was wired correctly.
 *
 * So this is a DELIBERATE divergence from live, recorded in docs/deviations.md, and it is the
 * same rule as the hero captions whose colour we override: **unreadable is a defect, not a
 * difference — and so is a message that misdirects.** Verified 2026-08-26 that live really
 * does say "Select Styles for Availability" here, so this is a departure and not a fix.
 *
 * **Unknown.**
 *
 * Roughly a third of variants have no inventory record at all — their SKU was never in the
 * fulfillment feed. Rendering that as "In Stock" invents stock; rendering it as "not
 * available" invents a sell-out, and 12.9% of them are demonstrably on sale on the live
 * site right now. Neither claim is one YD can stand behind, so the page says what is true
 * and leaves the size buyable.
 */
const AvailabilityLine = ({
  availability,
  backordered,
  backorderMessage,
  hasSelection,
  nothingSellable,
}: {
  availability: Availability
  /** Confirmed zero, but YD will still take the order. */
  backordered?: boolean
  /** Copy for the backorder case, from content — see lib/content/site-chrome.ts. */
  backorderMessage?: string
  hasSelection: boolean
  /** No variant on this product can be bought, so there is nothing to select. */
  nothingSellable?: boolean
}) => {
  let message: React.ReactNode = nothingSellable ? (
    <span className="inline-block px-2 py-0.5 rounded-base bg-ui-tag-red-bg text-ui-tag-red-text">
      Sold out
    </span>
  ) : (
    "Select Styles for Availability"
  )

  if (hasSelection) {
    switch (availability) {
      case "in-stock":
        message = "In Stock"
        break
      case "out-of-stock":
        message = backordered ? (
          <span className="inline-block px-2 py-0.5 rounded-base bg-ui-tag-orange-bg text-ui-tag-orange-text">
            {backorderMessage || "On backorder — not in stock today"}
          </span>
        ) : (
          <span className="inline-block px-2 py-0.5 rounded-base bg-ui-tag-red-bg text-ui-tag-red-text">
            This item is currently not available
          </span>
        )
        break
      case "unknown":
        message = (
          <span className="text-ui-fg-subtle">
            Stock not confirmed — you can still order it
          </span>
        )
        break
    }
  }

  return (
    // Wraps rather than overflowing: "On backorder — ships in 10-14 days" is wider than
    // the value column on a 320px phone.
    <div
      className="yd-buybox-label flex flex-wrap items-baseline gap-x-3 gap-y-1"
      data-testid="product-availability"
    >
      {/* Live sets the label and the value to the same 16px/24px rgba(32,34,35,.75) — it does
          not darken the value — so both simply inherit `.yd-buybox-label`. */}
      <span className="shrink-0">Availability:</span>
      <span className="min-w-0">{message}</span>
    </div>
  )
}

export default AvailabilityLine
