import { HttpTypes } from "@medusajs/types"

import { getBaseURL } from "@lib/util/env"
import { sfccProductId } from "@lib/util/product-identity"
import { productUrl } from "@lib/util/product-url"

export const YOTPO_APP_KEY = process.env.NEXT_PUBLIC_YOTPO_APP_KEY

/**
 * The data-* attributes Yotpo's widget script reads off a placeholder div.
 *
 * Both Yotpo widgets on a product page — the star line under the title and the reviews
 * section below the description — are empty divs that the script fills in client-side. The
 * attributes are copied from the live page's own markup so the widgets behave identically.
 *
 * Returns null when the product cannot be identified to Yotpo, and every caller must render
 * nothing in that case. See `sfccProductId`: matching on a Medusa handle instead silently
 * returns zero reviews rather than erroring, which reads as "nobody liked this" on a
 * catalogue whose mean rating is 4.34.
 */
export const yotpoAttrs = (
  product: HttpTypes.StoreProduct,
  countryCode: string
) => {
  const productId = sfccProductId(product)

  if (!YOTPO_APP_KEY || !productId) {
    return null
  }

  const base = getBaseURL()

  return {
    "data-appkey": YOTPO_APP_KEY,
    "data-domain": base,
    "data-product-id": productId,
    "data-name": product.title,
    // Reviews are filed against this URL — it must be the one that serves, not one
    // that redirects. See productUrl().
    "data-url": productUrl(base, countryCode, product.handle),
    // Yotpo uses these in review-request emails and shared review cards. The live page sends
    // the literal string "Image not available" when it has none, which is what shows up in
    // those emails — we send nothing instead and let Yotpo fall back.
    ...(product.thumbnail ? { "data-image-url": product.thumbnail } : {}),
    ...(product.description
      ? { "data-description": product.description }
      : {}),
  }
}
