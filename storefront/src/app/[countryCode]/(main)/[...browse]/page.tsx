import { Metadata } from "next"
import { notFound } from "next/navigation"

import { browseHref, findBrowseCategory } from "@lib/util/browse-categories"
import { resolveBrowseSort } from "@lib/util/browse-sort"
import { selectionFromParams } from "@lib/util/browse-facets"
import BrowseTemplate from "@modules/browse/templates"
import { PAGE_SIZE } from "@modules/browse/templates/browse-products"
import { metadataTitle } from "@lib/constants/store"
import { regionPath } from "@lib/util/product-url"

/**
 * Every browse URL the live site has, served from one route.
 *
 * The live paths do not share a prefix — /shop/tops, /collections/botanical,
 * /solids/jet-black, /new, /warehouse-sale, /insect/butterfly — and they must keep their
 * shapes, because 1,299 redirects and every inbound link and search result point at them.
 * A catch-all matches them all; Next resolves its own static segments (/cart, /account,
 * /products/…) ahead of it, so nothing existing is shadowed.
 */
type Props = {
  params: Promise<{ countryCode: string; browse: string[] }>
  // prefn1/prefv1 … are SFCC's filter syntax, read natively so every existing filtered link
  // keeps working with its filter intact — better for a human with a bookmark than a redirect
  // that silently drops what they filtered by, and it needs no redirect-map entries.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// Deliberately no generateStaticParams: sort and "show" are read from the query string, so
// these pages are rendered per request. Pre-rendering them meant Next tried to build them
// statically and every one 500'd with DYNAMIC_SERVER_USAGE. The Medusa calls underneath are
// cached, which is where the real cost is.
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { countryCode, browse } = await props.params
  const searchParams = await props.searchParams
  const category = findBrowseCategory(browse)
  if (!category) {
    return {}
  }
  // A filtered view canonicalises to the unfiltered category, which is what the live site
  // already tells Google — every ?prefn1=… URL there carries canonical=<the category>. That
  // keeps a migration from splitting authority across a combinatorial set of filter URLs.
  const canonical = regionPath(countryCode, browseHref(category))
  // The live page's own title and description, so a replatform does not quietly rewrite the
  // SEO of 64 pages that already rank.
  return {
    title: metadataTitle(category.seo_title),
    description: category.seo_description ?? undefined,
    alternates: { canonical },
  }
}

export default async function BrowsePage(props: Props) {
  const { countryCode, browse } = await props.params
  const searchParams = await props.searchParams
  const sort = typeof searchParams.sort === "string" ? searchParams.sort : undefined
  const show = typeof searchParams.show === "string" ? searchParams.show : undefined

  const category = findBrowseCategory(browse)
  if (!category) {
    notFound()
  }

  const requested = parseInt(show ?? "", 10)

  return (
    <BrowseTemplate
      category={category}
      sort={resolveBrowseSort(sort)}
      show={Number.isFinite(requested) && requested > 0 ? requested : PAGE_SIZE}
      selection={selectionFromParams(searchParams)}
      countryCode={countryCode}
    />
  )
}
