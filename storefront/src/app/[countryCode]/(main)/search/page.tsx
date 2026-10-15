import { Metadata } from "next"
import { Heading } from "@medusajs/ui"

import BrowseProducts, { PAGE_SIZE } from "@modules/browse/templates/browse-products"
import { resolveBrowseSort } from "@lib/util/browse-sort"
import { getCatalogue } from "@lib/data/products"
import { searchProducts } from "@lib/util/product-search"
import { BrowseCategory } from "@lib/util/browse-categories"
import { SEARCH_GROUP_ORDER, selectionFromParams } from "@lib/util/browse-facets"
import SearchBox from "@modules/search/components/search-box"
import { STORE_NAME } from "@lib/constants/store"

export const metadata: Metadata = {
  title: "Search",
  description: `Search ${STORE_NAME}.`,
  // A results page is not something to index — the URLs are unbounded and the content is a
  // reshuffle of pages that already exist.
  robots: { index: false, follow: true },
}

// Reads a query string, so nothing to prerender.
export const dynamic = "force-dynamic"

export default async function SearchPage(props: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { countryCode } = await props.params
  const searchParams = await props.searchParams
  const q = typeof searchParams.q === "string" ? searchParams.q : ""
  const sort = typeof searchParams.sort === "string" ? searchParams.sort : undefined
  const show = typeof searchParams.show === "string" ? searchParams.show : undefined
  const query = q.trim()

  // SFCC's own refinement syntax, read natively: ?prefn1=color&prefv1=Clever%20Koi.
  // Reproducing the syntax rather than mapping it means every filtered link that exists in
  // the wild keeps working, filter intact, with no redirect-map entries at all.
  const selection = selectionFromParams(searchParams)

  const requested = parseInt(show ?? "", 10)
  const visible = Number.isFinite(requested) && requested > 0 ? requested : PAGE_SIZE

  const catalogue = query ? await getCatalogue(countryCode) : []
  const matches = query ? searchProducts(catalogue, query) : []

  /**
   * Search results are a browse page with a different query, so they reuse yd-cat's grid
   * rather than a second one that would drift from it — same tiles, same sort control, same
   * "N Results" count. The grid takes a category, so the matches are handed over as one, in
   * relevance order: "Best Sellers" (the default sort) then means "most relevant".
   */
  const asCategory: BrowseCategory = {
    path: "/search",
    kind: "search",
    sfcc_cgid: null,
    live_url: "",
    seo_title: null,
    seo_description: null,
    heading: null,
    copy: null,
    hero: null,
    live_result_count: null,
    sfcc_hides_soldout: false,
    products: matches.map((p) => p.handle!).filter(Boolean),
  }


  return (
    <div className="content-container py-6">
      <Heading level="h1" className="text-2xl-semi mb-4">
        {query ? `Search results for "${query}"` : "Search"}
      </Heading>

      <div className="max-w-xl mb-8">
        <SearchBox initialQuery={query} autoFocus={!query} />
      </div>

      {!query && (
        <p className="text-ui-fg-subtle text-base-regular">
          Search by product, colour or print — or by what is on it, like “octopus”,
          “butterfly” or “moon”.
        </p>
      )}

      {query && !matches.length && (
        <div className="text-ui-fg-subtle text-base-regular py-8">
          <p className="mb-2">Nothing matched “{query}”.</p>
          <p className="txt-small">
            Try a single word — a colour, a print name, or an animal or motif.
          </p>
        </div>
      )}

      {query && matches.length > 0 && (
        <BrowseProducts
          category={asCategory}
          sort={resolveBrowseSort(sort)}
          show={visible}
          countryCode={countryCode}
          selection={selection}
          groupIds={SEARCH_GROUP_ORDER}
          basePath={`/search?q=${encodeURIComponent(query)}`}
          emptyMessage={`Nothing matched “${query}”.`}
        />
      )}
    </div>
  )
}
