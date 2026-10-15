import { HttpTypes } from "@medusajs/types"

import facetData from "../../content/facets.json"

/**
 * The live category pages' four refinement groups: Patterns, Type, Size, Length.
 *
 * Three are derived from catalogue data at render time. Type is not derivable — it is an SFCC
 * merchandising attribute with no Medusa equivalent — so it is read from the live site's own
 * filter and stored in src/content/facets.json.
 *
 * The URL syntax is SFCC's, deliberately: ?prefn1=productType&prefv1=Leggings. Those filtered
 * URLs are real, linkable and indexable today, so inventing our own syntax would break every
 * link a customer or Google holds, and would need a redirect rule nobody has written.
 */
export type FacetGroup = {
  /** SFCC's parameter name — productType, printsSolids, size, length. */
  id: string
  label: string
  values: { value: string; count: number }[]
}

export type Selection = { id: string; value: string }[]

const FACETS = (facetData as {
  facets: Record<string, Record<string, string[]>>
  value_order?: Record<string, string[]>
}).facets

/** The order the live site lists each refinement's values in — not alphabetical. */
const VALUE_ORDER = (facetData as { value_order?: Record<string, string[]> }).value_order ?? {}

const GROUP_LABELS: Record<string, string> = {
  printsSolids: "Patterns",
  productType: "Type",
  size: "Size",
  length: "Length",
  color: "Color",
}

/** SFCC's own order down the page. */
const GROUP_ORDER = ["printsSolids", "productType", "size", "length"]

/**
 * Search offers one refinement a category does not: Color.
 *
 * That asymmetry is the live site's, not an oversight — the colour refinement appears on
 * /search and on no category page, so category pages keep GROUP_ORDER unchanged. Its 98
 * values are captured in data/sfcc-search-facets.json; 97 of them match a product in our
 * catalogue, the miss being a product that never imported rather than a naming mismatch.
 */
export const SEARCH_GROUP_ORDER = [
  "printsSolids",
  "productType",
  "color",
  "size",
  "length",
]

const SIZE_ORDER = ["2XS", "XXS", "XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "XXXL"]

/**
 * The live site labels the extended sizes 2XS / 2XL / 3XL on 222 products; the catalogue
 * import standardised on XXS / XXL / XXXL. yd-features ruled the 2XL form wins — it is the
 * majority by 7.6 to 1 and what these customers already see — but the import has not changed
 * yet, so the label is translated at the point of display. Filtering is unaffected: both
 * forms already fold to the same value.
 */
const SIZE_LABELS: Record<string, string> = {
  XXS: "2XS",
  XXL: "2XL",
  XXXL: "3XL",
}

export const sizeLabel = (value: string) => SIZE_LABELS[value.toUpperCase()] ?? value

/**
 * Live length labels are inconsistently encoded — straight and curly quotes for the same
 * value, and a stray double space in `Short  (30”)`. Comparing them raw silently drops
 * products from a filter, which looks like a small category rather than a bug.
 */
const SIZE_EQUIVALENTS: Record<string, string> = {
  "2xs": "xxs",
  "2xl": "xxl",
  "3xl": "xxxl",
}

export function normaliseFacetValue(value: string): string {
  const cleaned = value
    .replace(/[‘’“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
  // 2XL and XXL are the same size. The live site writes the 2XL form on 222 products and the
  // XXL form on 29; the catalogue import standardised on XXL. Without this, a customer
  // following an existing, indexed ?prefv1=2XL link would land on a filter that matches
  // nothing — which reads as "sold out in your size", not as a broken link.
  return SIZE_EQUIVALENTS[cleaned] ?? cleaned
}

/**
 * Variant options carry only an option_id, not the option's name — the Store API returns
 * `option: { id }` and nothing else. The titles live on the product, so the id has to be
 * resolved through product.options first. Matching on the id alone would work per product
 * and fail across products, since every product has its own Size option with its own id.
 */
/**
 * A variant we can say with confidence a customer cannot buy: stock is tracked, there is none,
 * and backorders are off. Everything else counts.
 *
 * The live site's size facet counts only sizes in stock, and copying that rule outright would
 * be wrong here for two reasons. YD takes backorders at scale — 1,314 orders are On Order —
 * and a zero-stock variant with backorders enabled is still purchasable. And a third of
 * variants are not stock-managed at all, where null means absent from the feed, not zero.
 * Excluding both would hide sizes customers can actually order, and it would present as
 * "sold out in your size" rather than as a bug.
 *
 * Measured against the live site: 2XL on Tops is 128 products by "exists", 66 by strict
 * in-stock, and 92 on the live site — so SFCC's stock picture and Medusa's genuinely disagree
 * and neither rule reproduces it. Given that, the rule that never hides something buyable is
 * the one to ship.
 */
function unavailable(variant: any): boolean {
  return (
    variant?.manage_inventory === true &&
    (variant?.inventory_quantity ?? 0) <= 0 &&
    variant?.allow_backorder !== true
  )
}

function optionValues(product: HttpTypes.StoreProduct, title: string): string[] {
  const ids = new Set(
    (product.options ?? [])
      .filter((o) => (o.title ?? "").toLowerCase() === title.toLowerCase())
      .map((o) => o.id)
  )
  if (!ids.size) return []

  const out: string[] = []
  for (const variant of product.variants ?? []) {
    if (unavailable(variant)) continue
    for (const option of (variant as any).options ?? []) {
      if (ids.has(option?.option_id) && option?.value && !out.includes(option.value)) {
        out.push(option.value)
      }
    }
  }
  return out
}

function valuesFor(product: HttpTypes.StoreProduct, groupId: string): string[] {
  switch (groupId) {
    // Type and Prints/Solids come from the live site's own filters (see facets.json).
    // Prints/Solids looked derivable from the print code — 2500-2599 is the solid range — and
    // that derivation was wrong: print codes are recycled, so solids also sit at low codes
    // (Maroon 1120-5, Forest Green 1120-7). It returned 68 solid bottoms against the live
    // site's 96, silently, with no error and a plausible-looking number.
    case "productType":
    case "printsSolids":
      return FACETS[product.handle ?? ""]?.[groupId] ?? []
    // Length is read from the live site too, and had to be. Medusa knows two lengths because
    // only those are modelled as an option; the live site offers eight, and the missing six
    // belong to garments the catalogue stores as separate products per inseam (the Ultimate
    // Trouser is handles 1119/1129/1130). A facet derived from options cannot see a length
    // that is a product. Variant options are the fallback for anything the scrape missed.
    case "length":
      return FACETS[product.handle ?? ""]?.length?.length
        ? FACETS[product.handle ?? ""].length
        : optionValues(product, "Length")
    case "color": {
      // The colourway is the half of the title after the separator: "YD Legging - Clever Koi".
      // Read from the title rather than a colour attribute because Medusa has no colour
      // option — colour is a product, not a variant, in this catalogue.
      const title = product.title ?? ""
      const parts = title.split(/\s-\s|\s-(?=\S)|(?<=\S)-\s/)
      return parts.length > 1 ? [parts[parts.length - 1].trim()] : []
    }
    case "size":
      return optionValues(product, "Size")
    default:
      return []
  }
}

/** Does this product satisfy every selected refinement? Values within a group are OR'd. */
export function matchesSelection(
  product: HttpTypes.StoreProduct,
  selection: Selection
): boolean {
  const byGroup = new Map<string, string[]>()
  for (const { id, value } of selection) {
    byGroup.set(id, [...(byGroup.get(id) ?? []), value])
  }
  for (const [groupId, wanted] of byGroup) {
    const have = valuesFor(product, groupId).map(normaliseFacetValue)
    if (!wanted.some((w) => have.includes(normaliseFacetValue(w)))) {
      return false
    }
  }
  return true
}

/**
 * The refinement groups for a set of products, with counts.
 *
 * Counts are computed against the products that pass the OTHER groups' selections, which is
 * what makes a filter usable: picking "Leggings" should leave the Size counts describing
 * leggings, not the whole category. A group never filters itself out of existence.
 */
export function buildFacets(
  products: HttpTypes.StoreProduct[],
  selection: Selection,
  groupIds: string[] = GROUP_ORDER
): FacetGroup[] {
  const groups: FacetGroup[] = []

  for (const groupId of groupIds) {
    const others = selection.filter((s) => s.id !== groupId)
    const pool = products.filter((p) => matchesSelection(p, others))

    const counts = new Map<string, { display: string; count: number }>()
    for (const product of pool) {
      for (const value of valuesFor(product, groupId)) {
        const key = normaliseFacetValue(value)
        const entry = counts.get(key)
        if (entry) {
          entry.count += 1
        } else {
          counts.set(key, { display: value, count: 1 })
        }
      }
    }
    if (!counts.size) continue

    let values = [...counts.values()].map((v) => ({
      value: groupId === "size" ? sizeLabel(v.display) : v.display,
      count: v.count,
    }))
    if (groupId === "size") {
      values.sort(
        (a, b) =>
          (SIZE_ORDER.indexOf(a.value.toUpperCase()) + 1 || 99) -
          (SIZE_ORDER.indexOf(b.value.toUpperCase()) + 1 || 99)
      )
    } else if (groupId === "length") {
      // Lengths sort by INSEAM, not alphabetically — 28", 30", 32", 34", 36".
      //
      // This is a deliberate deviation from the live site, which lists them A-Z and so reads
      // "Extra Long, Long/Extra Long, Long, Regular, Short/Reg, Short, Standard" — nonsense
      // for a measurement. Two reasons to break parity here. The merge left TWO length
      // vocabularies coexisting (Short/Regular/Long on trousers, Standard/Extra Long on
      // leggings), and yd-pdp has already ordered the product page's selector by inseam; a
      // facet sorted A-Z would disagree with the page it sends the customer to. The rule that
      // internal consistency beats live-matching was set over the 2XL/XXL split, and this is
      // the same shape. The A-Z order is an SFCC artefact rather than a choice anyone made.
      const inches = (v: string) => {
        const m = /(\d{2})\s*(?:"|”|″|in)/.exec(v)
        return m ? parseInt(m[1], 10) : 999
      }
      values.sort((a, b) => inches(a.value) - inches(b.value) || a.value.localeCompare(b.value))
    } else if (VALUE_ORDER[groupId]?.length) {
      const live = VALUE_ORDER[groupId].map(normaliseFacetValue)
      values.sort(
        (a, b) =>
          (live.indexOf(normaliseFacetValue(a.value)) + 1 || 99) -
          (live.indexOf(normaliseFacetValue(b.value)) + 1 || 99)
      )
    } else {
      values.sort((a, b) => a.value.localeCompare(b.value))
    }

    groups.push({ id: groupId, label: GROUP_LABELS[groupId] ?? groupId, values })
  }

  return groups
}

/** Read SFCC's prefn1/prefv1 … prefnN/prefvN pairs out of the query string. */
export function selectionFromParams(
  params: Record<string, string | string[] | undefined>
): Selection {
  const selection: Selection = []
  for (let n = 1; n <= 8; n++) {
    const name = params[`prefn${n}`]
    const value = params[`prefv${n}`]
    if (typeof name !== "string" || typeof value !== "string") continue
    // SFCC joins multiple values in one group with a pipe.
    for (const one of value.split("|")) {
      if (one) selection.push({ id: name, value: one })
    }
  }
  return selection
}

/** Write a selection back out in SFCC's syntax, grouping repeated values with a pipe. */
export function paramsFromSelection(selection: Selection): string {
  const byGroup = new Map<string, string[]>()
  for (const { id, value } of selection) {
    const existing = byGroup.get(id) ?? []
    if (!existing.some((v) => normaliseFacetValue(v) === normaliseFacetValue(value))) {
      byGroup.set(id, [...existing, value])
    } else {
      byGroup.set(id, existing)
    }
  }
  const parts: string[] = []
  let n = 1
  for (const [id, values] of byGroup) {
    parts.push(`prefn${n}=${encodeURIComponent(id)}`)
    parts.push(`prefv${n}=${encodeURIComponent(values.join("|"))}`)
    n++
  }
  return parts.join("&")
}

/** The selection with one value toggled on or off. */
export function toggled(selection: Selection, id: string, value: string): Selection {
  const present = selection.some(
    (s) => s.id === id && normaliseFacetValue(s.value) === normaliseFacetValue(value)
  )
  return present
    ? selection.filter(
        (s) => !(s.id === id && normaliseFacetValue(s.value) === normaliseFacetValue(value))
      )
    : [...selection, { id, value }]
}

export function isSelected(selection: Selection, id: string, value: string): boolean {
  return selection.some(
    (s) => s.id === id && normaliseFacetValue(s.value) === normaliseFacetValue(value)
  )
}
