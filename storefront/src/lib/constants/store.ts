/**
 * One place for the store's name.
 *
 * The starter hardcodes "Medusa Store" in 15 spots across 10 files. That is the kind of
 * string that gets 14 of 15 updated — and it ends up in page titles, tab labels, link
 * previews and (later) transactional email, so a miss is visible to customers.
 *
 * Deliberately a build-time constant rather than a Store API lookup: it is needed inside
 * `generateMetadata`, which runs before any request-scoped data fetch, and a network round
 * trip per page title to render a word that changes roughly never is a poor trade.
 */
export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "Yoga Democracy"

/**
 * Suffix for page <title>s: "Free Range Sports Bra | Yoga Democracy".
 *
 * Skips the suffix when the title already ends with the store name. 34 of the 64 SEO titles
 * carried over from SFCC already end in "| Yoga Democracy", and appending blindly rendered
 * "Bells | Yoga Democracy | Yoga Democracy" on every one of them -- in the browser tab, the
 * search result and the link preview.
 */
/**
 * A page <title> for Next's `metadata.title`, honouring the root layout's
 * `template: "%s | Yoga Democracy"`.
 *
 * Titles inherited from SFCC already end in the store name for 34 of 64 pages, and the
 * template appended it again. Returning `{ absolute }` suppresses the template for those,
 * so each page ends up with the store name exactly once however its title was written.
 */
export const metadataTitle = (title?: string | null) => {
  const trimmed = title?.trim()
  if (!trimmed) return undefined
  return trimmed.toLowerCase().endsWith(STORE_NAME.toLowerCase())
    ? { absolute: trimmed }
    : trimmed
}

export const titleWithStore = (title: string) => {
  const trimmed = title.trim()
  return trimmed.toLowerCase().endsWith(STORE_NAME.toLowerCase())
    ? trimmed
    : `${trimmed} | ${STORE_NAME}`
}

/**
 * Which categories are "where a product lives" rather than "how it is merchandised".
 *
 * A product sits in several categories at once — Goddess Tank - Twig is in Tops, Solids and
 * Best Sellers — but a breadcrumb has room for one, and the live site shows the merchandise
 * category (Home / Shop / Tops). Best Sellers and Solids are marketing groupings; landing a
 * customer in "Best Sellers" from a breadcrumb tells them nothing about where the garment
 * belongs.
 *
 * Config rather than a constant in the component, per the tenancy rules: another brand
 * organises its catalogue differently, and this is a merchandising decision, not logic.
 * Order is preference order.
 */
export const PRIMARY_CATEGORY_HANDLES = (
  process.env.NEXT_PUBLIC_PRIMARY_CATEGORIES || "tops,bottoms,accessories"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
