import { Heading } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"

import { listProducts } from "@lib/data/products"
import { productIdentity } from "@lib/util/product-identity"
import SetProduct from "./set-product"

const MAX_ITEMS = 8
const SEARCH_LIMIT = 50

/**
 * The colourway name, taken from the end of the product title.
 *
 * YD titles are "<Garment> - <Colourway>": "Om Tank - Twig", "Original Bell - Double
 * Rainbow". Siblings in a colourway share that trailing part, which makes it a usable
 * search term. Returns null when the title has no " - ", so the rail is skipped rather
 * than searching for something meaningless.
 */
const colourwayOf = (title?: string | null): string | null => {
  const parts = (title ?? "").split(" - ")
  if (parts.length < 2) return null
  const colour = parts[parts.length - 1].trim()
  return colour.length > 1 ? colour : null
}

/**
 * "Complete the Set" — the same colourway across every other style YD cuts it in.
 *
 * On the live page this is seven products all named "- Twig": bra, tank, legging, jacket,
 * jogger, trouser. It is **not** the Einstein recommendation rail; that is a separate slot
 * (`cq_recomm_slot-…`) further down the page and it does not migrate. This one is curated
 * by colourway, so it is reproducible without a recommendation engine.
 *
 * **Found by searching the colourway, then verified by print code.**
 *
 * The first version walked the whole catalogue — six sequential requests of 100 products
 * each, carrying full variant, price and image payloads, on every product page render.
 * Measured, that was most of an 11-second time to first byte; taking it out dropped TTFB to
 * about 2 seconds. Search returns the same set in one call: `q=Twig` gives 8 products, all
 * print code 2501.
 *
 * The two steps do different jobs and both are needed. Search is a cheap **filter** and is
 * allowed to be imprecise. The print-code check is the **correctness** step, so a title
 * that merely happens to contain the word cannot put a foreign garment in the rail — which
 * matters here, because cross-contamination between colourway siblings is exactly what put
 * a biker short on a Capri page in the image harvest.
 *
 * If search misses a sibling the rail is short. That is a much better failure than a page
 * nobody waits for: short is visible and fixable, slow gets blamed on the whole site.
 */
const CompleteTheSet = async ({
  product,
  countryCode,
}: {
  product: HttpTypes.StoreProduct
  countryCode: string
}) => {
  const { printCode } = productIdentity(product)
  const colourway = colourwayOf(product.title)

  if (!printCode || !colourway) {
    return null
  }

  let siblings: HttpTypes.StoreProduct[] = []

  try {
    const { response } = await listProducts({
      queryParams: { q: colourway, limit: SEARCH_LIMIT },
      countryCode,
    })

    siblings = response.products.filter(
      (candidate) =>
        candidate.id !== product.id &&
        productIdentity(candidate).printCode === printCode
    )
  } catch {
    // A cross-sell rail is never worth a broken product page.
    return null
  }

  if (!siblings.length) {
    return null
  }

  return (
    <div className="flex flex-col gap-y-2" data-testid="complete-the-set">
      <Heading level="h2" className="text-lg font-normal text-ui-fg-base">
        Complete the Set
      </Heading>
      {/* Colourways run to a dozen styles. The live rail scrolls inside itself rather than
          pushing the description off the page; same here. */}
      <div className="max-h-[650px] overflow-y-auto pr-1">
        {siblings.slice(0, MAX_ITEMS).map((sibling) => (
          <SetProduct key={sibling.id} product={sibling} />
        ))}
      </div>
    </div>
  )
}

export default CompleteTheSet
