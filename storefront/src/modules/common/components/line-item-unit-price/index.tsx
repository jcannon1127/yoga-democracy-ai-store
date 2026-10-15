import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import { clx } from "@medusajs/ui"

type LineItemUnitPriceProps = {
  item: HttpTypes.StoreCartLineItem | HttpTypes.StoreOrderLineItem
  style?: "default" | "tight"
  currencyCode: string
}

/**
 * The unit price of a cart line, and what it was before any discount.
 *
 * TWO different reductions can apply and only one of them was handled:
 *
 *   - a PROMOTION (a code, a cart rule) shows up as `total < original_total`, which is what
 *     this component tested;
 *   - a CATALOGUE SALE — the warehouse sale, most of what YD is selling right now — does not.
 *     Medusa's price list makes the sale price the line's own price, so `original_total` and
 *     `total` are equal and this component concluded there was no discount at all.
 *
 * **Measured, both sides, 2026-08-25.** On live's cart a sale line reads `$54.00` struck
 * through in grey beside `$20.00` in near-black bold. On ours it read `$20.00` and nothing
 * else: the customer lost the saving on the one page where they are deciding whether to buy.
 * The catalogue carries what is needed — `calculated_price.original_amount` 54 against
 * `calculated_amount` 20, `price_list_type: "sale"` — the cart simply never asked for it.
 *
 * Colours are live's own: struck original `rgb(153,153,153)`, the price itself in the ink
 * every other price uses. The starter painted a reduced price `text-ui-fg-interactive`, a
 * `#3b82f6` blue that appears nowhere in YD's palette — the same defect already removed from
 * the category tiles.
 */
const LineItemUnitPrice = ({
  item,
  style = "default",
  currencyCode,
}: LineItemUnitPriceProps) => {
  const { total, original_total } = item
  const quantity = item.quantity || 1

  // What one unit costs now.
  const unit = total / quantity

  // What it cost before, whichever kind of discount applies. A promotion moves
  // original_total; a catalogue sale leaves it alone and lives on the variant.
  // Attached by retrieveCart from the catalogue. NOT read off the cart payload: asking the
  // cart for `*items.variant.calculated_price` returns 400 on any cart that has a line, which
  // takes the whole cart down. See withCataloguePrices in lib/data/cart.ts.
  const catalogueOriginal =
    typeof (item as any)?.catalogue_original_price === "number"
      ? (item as any).catalogue_original_price
      : undefined

  const promoOriginal = original_total / quantity
  const original =
    promoOriginal > unit
      ? promoOriginal
      : catalogueOriginal && catalogueOriginal > unit
      ? catalogueOriginal
      : undefined

  const hasReducedPrice = original !== undefined
  const percentage_diff = hasReducedPrice
    ? Math.round(((original - unit) / original) * 100)
    : 0

  return (
    <div className="flex flex-col text-ui-fg-muted justify-center h-full">
      {hasReducedPrice && (
        <>
          <p>
            {style === "default" && (
              <span className="text-ui-fg-muted">Original: </span>
            )}
            <span
              className="line-through text-yd-ink-muted text-base"
              data-testid="product-unit-original-price"
            >
              {convertToLocale({
                amount: original,
                currency_code: currencyCode,
              })}
            </span>
          </p>
          {style === "default" && (
            /* Live prints its saving in the brand green, not a link blue. */
            <span className="text-yd-green">-{percentage_diff}%</span>
          )}
        </>
      )}
      <span
        className={clx("text-base", {
          "text-yd-ink font-semibold": hasReducedPrice,
        })}
        data-testid="product-unit-price"
      >
        {convertToLocale({
          amount: unit,
          currency_code: currencyCode,
        })}
      </span>
    </div>
  )
}

export default LineItemUnitPrice
