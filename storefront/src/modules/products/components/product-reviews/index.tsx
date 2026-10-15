import { HttpTypes } from "@medusajs/types"

import { yotpoAttrs } from "./yotpo-attrs"
import YotpoScript from "./yotpo-script"

/**
 * The customer reviews section, full width below the description — where the live page
 * carries `#yotpo-reviews-top-div`.
 *
 * Yotpo stays for launch and is replaced afterwards, so reviews are not rebuilt here; this
 * mounts the same widget the live site mounts, against the same product IDs, so the review
 * history carries over rather than starting from zero.
 *
 * Renders nothing — not an empty "Reviews" heading — when the app key is unset or the
 * product has no SFCC ID. 83 products have no live page and therefore no review history.
 */
const ProductReviews = ({
  product,
  countryCode,
}: {
  product: HttpTypes.StoreProduct
  countryCode: string
}) => {
  const attrs = yotpoAttrs(product, countryCode)

  if (!attrs) {
    return null
  }

  return (
    <section className="content-container py-10" data-testid="product-reviews">
      <div id="yotpo-reviews-top-div" className="yotpo yotpo-main-widget" {...attrs} />
      <YotpoScript />
    </section>
  )
}

export default ProductReviews
