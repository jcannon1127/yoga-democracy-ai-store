
import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"

/**
 * Price, laid out the way the live product page lays it out: the old price struck through,
 * the current price immediately after it on the same line, both at ~21px.
 *
 * Two deliberate differences from the starter:
 *
 * - **No "From $X" and no "-69%" badge.** YD discounts at product level, so every size of a
 *   style shares one price and "From" would be noise. The percentage badge is a starter
 *   flourish that appears nowhere on yogademocracy.com.
 * - **The old price is not labelled "Original:".** The live page relies on the strike-
 *   through alone, with screen-reader-only "Price reduced from ... to ..." text, which is
 *   both quieter visually and better for assistive tech. Copied verbatim.
 */
export default function ProductPrice({
  product,
  variant,
}: {
  product: HttpTypes.StoreProduct
  variant?: HttpTypes.StoreProductVariant
}) {
  const { cheapestPrice, variantPrice } = getProductPrice({
    product,
    variantId: variant?.id,
  })

  const selectedPrice = variant ? variantPrice : cheapestPrice

  if (!selectedPrice) {
    return <div className="block w-32 h-8 bg-gray-100 animate-pulse" />
  }

  const onSale = selectedPrice.price_type === "sale"

  return (
    // Live: 18px on phones, 21px from 769px up — its own breakpoint, the same one the title
    // and the breadcrumb use. Line-height is 1.5 at both sizes. Measured across ten widths.
    <div
      className="flex items-baseline gap-x-2 text-[18px] leading-[1.5] min-[769px]:text-[1.3125rem]"
      data-testid="product-price-block"
    >
      {onSale && (
        <del
          // Live strikes the old price in rgba(32,34,35,.5); Medusa's `fg-muted` is zinc-500,
          // which is a cooler grey against YD's warm near-black.
          className="text-[rgba(32,34,35,0.5)] decoration-[rgba(32,34,35,0.5)]"
          data-testid="original-product-price"
          data-value={selectedPrice.original_price_number}
        >
          <span className="sr-only">Price reduced from</span>
          {selectedPrice.original_price}
          <span className="sr-only">to</span>
        </del>
      )}
      <span
        // #202223, not Medusa's `fg-base` zinc-900 (#18181b). Only visible on a full-price
        // product: every sale product shows the struck price beside it, and against that the
        // two near-blacks are indistinguishable. Found by widening the sweep to 20 products
        // rather than by looking harder at the two already being checked.
        className="text-[#202223] font-normal"
        data-testid="product-price"
        data-value={selectedPrice.calculated_price_number}
      >
        {selectedPrice.calculated_price}
      </span>
    </div>
  )
}
