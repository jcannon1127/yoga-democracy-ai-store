import { Text } from "@medusajs/ui"
import { VariantPrice } from "types/global"

/**
 * The price on a category tile — browse, search and Complete-the-Set all use this card.
 *
 * The starter coloured a SALE price `text-ui-fg-interactive`, which computes to #3b82f6:
 * **a blue that appears nowhere in YD's palette**, on the one number a shopper is most likely
 * to look at, across every browse and search result. Measured on the live category page
 * (/shop/bottoms/) instead of guessed: the sale price and the regular price are both
 * rgb(32,34,35) at 14px/400, and the struck original is the same colour at 50% alpha with
 * line-through. Ours were rgb(59,130,246) and rgb(113,113,122).
 *
 * Reported by yd-pdp, who measured the blue while fixing the product page's own typography.
 */
export default async function PreviewPrice({ price }: { price: VariantPrice }) {
  if (!price) {
    return null
  }

  return (
    <>
      {price.price_type === "sale" && (
        <Text
          className="line-through text-yd-ink-faded"
          data-testid="original-price"
        >
          {price.original_price}
        </Text>
      )}
      <Text
        className="text-yd-ink"
        data-testid="price"
      >
        {price.calculated_price}
      </Text>
    </>
  )
}
