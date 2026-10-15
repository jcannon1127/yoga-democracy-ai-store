import { HttpTypes } from "@medusajs/types"

/**
 * Reading YD's own identifiers back out of a Medusa product.
 *
 * A YD SKU is style + size + print code, concatenated: `1114XS194` is style 1114, size XS,
 * print 194. Two of those three are the product's identity — every size of "Original Bell -
 * Double Rainbow" shares style 1114 and print 194 — and they are what the rest of the
 * business runs on: the factory cuts by style, the colourway rail groups by print code, and
 * the sale sheets key on both.
 *
 * Three sources, in descending order of trust: **product metadata** (`style`, `print_code` —
 * stated by the catalogue import, present on all 552 products), then the **SKU** (inferred,
 * but where this identity has always really lived), then the **handle** as a courtesy.
 *
 * Handles are last on purpose. They end `-1114-194` today, but they belong to the catalogue
 * import and are still moving — style suffixes come off as inseam mappings get confirmed, and
 * some will change again to preserve the SFCC slugs the redirect map and Yotpo key on.
 * Anything that reads identity out of a handle breaks quietly on the day one changes.
 */

const SKU_PATTERN = /^(\d{3,4})([A-Z]+)(\d{1,4})$/
const HANDLE_SUFFIX = /-(\d{3,4})-(\d{1,4})$/

export type ProductIdentity = {
  /** Style number — the garment. `1103` is the standard-length YD Legging. */
  style?: string
  /** Print code — the colourway. `194` is Double Rainbow, `2501` is Twig. */
  printCode?: string
}

const fromSku = (sku?: string | null): ProductIdentity => {
  const match = sku?.trim().toUpperCase().match(SKU_PATTERN)
  if (!match) return {}
  return { style: match[1], printCode: match[3] }
}

const fromHandle = (handle?: string | null): ProductIdentity => {
  const match = handle?.match(HANDLE_SUFFIX)
  if (!match) return {}
  return { style: match[1], printCode: match[2] }
}

/**
 * Style and print code for a product. SKUs first, handle as a fallback.
 *
 * Takes the first SKU that parses rather than assuming variant order — the first variant is
 * not reliably the smallest size, and a malformed SKU should not decide the answer for the
 * whole product. (Some SFCC records really are malformed: yd-alloc found rows where a URL
 * slug is glued to a real SKU, e.g. `YD-LEGGING-GOLDEN-GIRL-1101XS173`.)
 */
export const productIdentity = (
  product: Pick<HttpTypes.StoreProduct, "handle" | "variants" | "metadata">
): ProductIdentity => {
  // Metadata first: the catalogue agent writes `style` and `print_code` on all 552 products, which is
  // the identity stated rather than inferred. Nothing has to be parsed and nothing breaks
  // when a SKU is malformed.
  const metadata = (product.metadata ?? {}) as Record<string, unknown>
  const style = metadata.style
  const printCode = metadata.print_code
  if (typeof style === "string" && typeof printCode === "string" && style && printCode) {
    return { style, printCode }
  }

  // Then the SKU, which is where identity has always really lived.
  for (const variant of product.variants ?? []) {
    const identity = fromSku(variant.sku)
    if (identity.style && identity.printCode) {
      return identity
    }
  }

  // Handles last, and only as a courtesy — they are the least stable of the three.
  return fromHandle(product.handle)
}

/**
 * The SFCC product ID this product came from — what Yotpo files reviews under, what the
 * redirect map is keyed on, and what Google has indexed.
 *
 * **Read it from metadata; never fall back to the handle.** the catalogue agent measured the damage of
 * guessing: match Yotpo on the Medusa handle and 192 of 608 products lose their stars with no
 * error at all. The mismatches are structural, not tidy-up work — 45 products merge Size x
 * Length into one page where SFCC served two, 33 keep a style suffix until someone confirms
 * which inseam 1118 and 1119 are, 4 differ only in case because SFCC slugs are not reliably
 * lowercase and Medusa rejects capitals, and 56 live products are not in the launch set.
 *
 * Handles are also still moving — they belong to the catalogue import and change as those
 * mappings get resolved. `sfcc_pid` does not. Binding to the handle means every future handle
 * change silently drops reviews, which is exactly the kind of failure nobody notices for a
 * month.
 *
 * 464 of 552 products carry it. The other 88 have no live SFCC page and therefore no review
 * history, so callers must render nothing rather than a zero — an unrated product reads as
 * new, a zero-star product reads as bad.
 */
export const sfccProductId = (
  product: Pick<HttpTypes.StoreProduct, "metadata">
): string | undefined => {
  const metadata = (product.metadata ?? {}) as Record<string, unknown>
  const candidate =
    metadata.sfcc_pid ??
    metadata.sfcc_product_id ??
    metadata.sfcc_id ??
    metadata.sfcc_slug

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined
}
