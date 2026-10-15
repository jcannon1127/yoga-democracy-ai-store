import { getCatalogue } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { getProductPrice } from "@lib/util/get-product-price"
import { BrowseCategory, browseHref } from "@lib/util/browse-categories"
import { HttpTypes } from "@medusajs/types"
import ProductPreview from "@modules/products/components/product-preview"
import ProductRating from "@modules/products/components/product-rating"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { BrowseSort } from "@lib/util/browse-sort"
import SortSelect from "@modules/browse/components/sort-select"
import RefinementBar from "@modules/browse/components/refinement-bar"
import {
  Selection,
  buildFacets,
  matchesSelection,
  paramsFromSelection,
} from "@lib/util/browse-facets"

export const PAGE_SIZE = 12

/**
 * Every product in the catalogue, once, so a category can be assembled from it.
 *
 * A category is a list of handles and the Store API filters on one handle at a time, so the
 * choice is 200 requests or one pass over the catalogue. The requests are cached by Next, so
 * this is six cached calls at today's 552 products — the same trick the all-products listing
 * already uses. It also means membership is resolved against what Medusa actually has rather
 * than against what the live site said it had.
 */
function priceOf(product: HttpTypes.StoreProduct): number {
  const price = getProductPrice({ product }).cheapestPrice
  // A product with no resolvable price sorts last rather than free.
  return price?.calculated_price_number ?? Number.POSITIVE_INFINITY
}

export function sortForBrowse(
  products: HttpTypes.StoreProduct[],
  sort: BrowseSort
): HttpTypes.StoreProduct[] {
  const sorted = [...products]
  switch (sort) {
    case "a-z":
      sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      break
    case "z-a":
      sorted.sort((a, b) => (b.title || "").localeCompare(a.title || ""))
      break
    case "price-low":
      sorted.sort((a, b) => priceOf(a) - priceOf(b))
      break
    case "price-high":
      sorted.sort((a, b) => priceOf(b) - priceOf(a))
      break
    default:
      break // "featured" keeps the live site's own merchandised order
  }

  // Products without photography go last in every sort — 185 of 552 have no image yet, and a
  // row of blanks at the top of a category reads as a broken site. Sorting is stable, so the
  // chosen order still holds within each group. Matches the all-products listing's behaviour.
  sorted.sort((a, b) => Number(Boolean(b.thumbnail)) - Number(Boolean(a.thumbnail)))
  return sorted
}

export default async function BrowseProducts({
  category,
  sort,
  show,
  selection,
  countryCode,
  groupIds,
  basePath,
  emptyMessage,
}: {
  category: BrowseCategory
  sort: BrowseSort
  show: number
  selection: Selection
  countryCode: string
  /**
   * Search reuses this whole template. It supplies its own facet groups (search offers
   * Color, category pages do not — the live site's asymmetry) and its own base path
   * (/search?q=… rather than a category URL). Category pages pass neither and are unchanged.
   */
  groupIds?: string[]
  basePath?: string
  emptyMessage?: string
}) {
  const region = await getRegion(countryCode)
  if (!region) {
    return null
  }

  const catalogue = await getCatalogue(countryCode)
  const ok = catalogue.length > 0
  const byHandle = new Map(catalogue.map((p) => [p.handle, p]))

  // Registry order IS the live site's Featured order, so membership is resolved by walking
  // the registry rather than filtering the catalogue.
  const members = category.products
    .map((handle) => byHandle.get(handle))
    .filter((p): p is HttpTypes.StoreProduct => Boolean(p))

  const facets = buildFacets(members, selection, groupIds)
  const filtered = selection.length
    ? members.filter((p) => matchesSelection(p, selection))
    : members
  const ordered = sortForBrowse(filtered, sort)
  const visible = ordered.slice(0, show)

  if (!ok && !ordered.length) {
    return (
      <p className="py-16 text-center text-base-regular text-ui-fg-subtle">
        We could not load this category just now. Please refresh in a moment.
      </p>
    )
  }

  if (!ordered.length && !selection.length) {
    return (
      <p className="py-16 text-center text-base-regular text-ui-fg-subtle">
        {emptyMessage ?? "Nothing in this category is in the catalogue yet."}
      </p>
    )
  }

  const more = [
    paramsFromSelection(selection),
    `sort=${sort}`,
    `show=${show + PAGE_SIZE}`,
  ]
    .filter(Boolean)
    .join("&")

  return (
    <>
      <div className="text-center text-base-regular py-4" data-testid="result-count">
        <span>{ordered.length} Results</span>
      </div>

      {/* Breakpoints are min-[768px], NOT tailwind's `small:`.
          In this config `small` is 1024px — it does not mean "small screens", and reading it
          that way put the layout a whole device class out: the live site switches to three
          columns and shows the filter rail at its `md` breakpoint of 768px, so between 768 and
          1024 — iPad portrait — live showed three columns with a sidebar while this showed two
          and a Filter button. The same misreading had already hidden the account link on every
          phone elsewhere in the storefront. */}
      <div className="flex flex-col min-[768px]:flex-row gap-x-8">
        <aside className="w-full min-[768px]:w-1/4 min-[768px]:shrink-0">
          <div className="pb-6">
            <SortSelect sort={sort} />
          </div>
          <RefinementBar
            basePath={basePath ?? browseHref(category)}
            groups={facets}
            selection={selection}
            sort={sort}
          />
        </aside>

        <div className="w-full">
          {ordered.length === 0 ? (
            <p className="py-16 text-center text-base-regular text-ui-fg-subtle">
              No products match these filters.
            </p>
          ) : (
            <ul
              className="grid grid-cols-2 w-full min-[768px]:grid-cols-3 gap-x-6 gap-y-8"
              data-testid="products-list"
            >
              {visible.map((product) => (
                <li key={product.id}>
                  <ProductPreview product={product} region={region} />
                  {/* The live tile carries a star line under the price, and the catalogue's
                      mean rating is 4.34 — it is a trust signal on the page a customer
                      chooses FROM, not a product-page detail. Renders nothing until the
                      Yotpo app key is in the environment, and nothing for a product with no
                      SFCC id, because showing zero stars is a claim while showing none is
                      not. yd-pdp's component, reused rather than reimplemented. */}
                  <div className="pt-1">
                    <ProductRating product={product} countryCode={countryCode} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {show < ordered.length && (
            <div className="flex justify-center pt-12">
              <LocalizedClientLink
                href={`${browseHref(category)}?${more}`}
                className="border border-ui-border-interactive px-12 py-3 text-base-regular hover:bg-ui-bg-subtle w-full small:w-auto text-center"
                data-testid="more-results"
              >
                More Results
              </LocalizedClientLink>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
