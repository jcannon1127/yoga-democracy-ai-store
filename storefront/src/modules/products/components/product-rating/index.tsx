import { HttpTypes } from "@medusajs/types"

import { yotpoAttrs } from "@modules/products/components/product-reviews/yotpo-attrs"
import YotpoScript from "@modules/products/components/product-reviews/yotpo-script"

/**
 * The star line under the product name — the Yotpo widget, and ONLY the Yotpo widget.
 *
 * **Do not add a rating string here, and do not "restore" the one the live page appears to
 * have.** Live emits `<span class="sr-only">3.1 out of 5 Customer Rating</span>` — SFCC's own
 * per-product value, for assistive technology — and then an EMPTY Yotpo div that JavaScript
 * fills. Those are different numbers from different systems: yd-features found ~474 products
 * whose sr-only text announces a rating to a screen-reader user that no sighted visitor is
 * shown and that Yotpo has no reviews behind. A blind customer hears "3.1 out of 5" on a page
 * that visibly carries no stars. Copying it would import an accessibility defect, and the
 * standing instruction is not to. Verified on the deployed build: 0 occurrences of "out of 5".
 *
 * Yotpo fills this div in client-side; all we place is the anchor and the product's identity.
 * Attributes come from the shared helper so the star line and the reviews section below can
 * never key on different things and disagree about which product this is.
 *
 * **Renders nothing unless there is both an app key and an SFCC product ID**, and that is the
 * point. Matching Yotpo on the Medusa handle instead would silently return zero reviews for
 * roughly a third of the catalogue — a 4.4-star product rendering as unrated, looking like a
 * Yotpo outage rather than a mapping mistake. Showing no stars is honest; showing zero stars
 * is a claim.
 *
 * **This div is the ONLY rating this component emits, and that is deliberate.** Live also
 * carries `<span class="sr-only">N out of 5 Customer Rating</span>` — SFCC's own value,
 * server-rendered for assistive technology, present on 100% of products while the visible
 * widget fills on about a third. Roughly 474 products therefore announce a rating to a
 * screen-reader user that no sighted visitor sees and that Yotpo has no reviews behind.
 * **The new site must not copy it** (yd-features, 2026-08-26) — an instruction, not a
 * judgement call, and this component already complies: it renders an empty anchor and lets
 * Yotpo fill it from real reviews.
 *
 * An earlier version of this comment cited "the mean rating across the live catalogue is
 * 4.34" as the reason the line matters. **That figure is the mean of the sr-only
 * ACCESSIBILITY text, not of a visible rating** — right number, wrong audience — so it argued
 * for this design using the very value the design exists to avoid. Removed rather than
 * restated.
 */
const ProductRating = ({
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
    <>
      <div
        id="yotpo-bottomline-top-div"
        className="yotpo bottomLine"
        data-testid="product-rating"
        {...attrs}
      />
      <YotpoScript />
    </>
  )
}

export default ProductRating
