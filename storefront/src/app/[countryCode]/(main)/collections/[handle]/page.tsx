import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getCollectionByHandle, listCollections } from "@lib/data/collections"
import { listRegions } from "@lib/data/regions"
import { StoreCollection, StoreRegion } from "@medusajs/types"
import CollectionTemplate from "@modules/collections/templates"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import { STORE_NAME, metadataTitle } from "@lib/constants/store"
import { findBrowseCategory } from "@lib/util/browse-categories"
import { resolveBrowseSort } from "@lib/util/browse-sort"
import { selectionFromParams } from "@lib/util/browse-facets"
import BrowseTemplate from "@modules/browse/templates"
import { PAGE_SIZE } from "@modules/browse/templates/browse-products"

/**
 * /collections/<handle> is a real live-site URL — /collections/botanical, /collections/geometry
 * — and this starter route sits on top of it. Medusa has no collections at all, so on its own
 * it could only 404 or 500 every one of them.
 *
 * Rather than delete a route the storefront may yet use, it falls through: if Medusa knows the
 * collection it renders it, and otherwise the page is served from the browse registry like any
 * other category page. Next resolves this static segment ahead of the [...browse] catch-all, so
 * the fall-through is what makes those URLs reachable at all.
 */
type Props = {
  params: Promise<{ handle: string; countryCode: string }>
  searchParams: Promise<{
    page?: string
    sortBy?: SortOptions
    sort?: string
    show?: string
  }>
}

export const PRODUCT_LIMIT = 12

// This route pre-renders (generateStaticParams below), but the browse fall-through reads
// `sort` and `show` from the query string, and reading search params inside a static render
// throws DYNAMIC_SERVER_USAGE — which surfaced as a 500 on every /collections/* page. There
// is nothing to pre-render anyway while Medusa has no collections; the Medusa calls behind
// both branches are cached.
export const dynamic = "force-dynamic"

export async function generateStaticParams() {
  const { collections } = await listCollections({
    fields: "*products",
  })

  if (!collections) {
    return []
  }

  const countryCodes = await listRegions().then(
    (regions: StoreRegion[]) =>
      regions
        ?.map((r) => r.countries?.map((c) => c.iso_2))
        .flat()
        .filter(Boolean) as string[]
  )

  const collectionHandles = collections.map(
    (collection: StoreCollection) => collection.handle
  )

  const staticParams = countryCodes
    ?.map((countryCode: string) =>
      collectionHandles.map((handle: string | undefined) => ({
        countryCode,
        handle,
      }))
    )
    .flat()

  return staticParams
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const collection = await getCollectionByHandle(params.handle)

  if (!collection) {
    const category = findBrowseCategory(["collections", params.handle])
    if (!category) {
      notFound()
    }
    return {
      title: metadataTitle(category.seo_title),
      description: category.seo_description ?? undefined,
    }
  }

  const metadata = {
    title: collection.title,
    description: `${collection.title} collection`,
  } as Metadata

  return metadata
}

export default async function CollectionPage(props: Props) {
  const searchParams = await props.searchParams
  const params = await props.params
  const { sortBy, page } = searchParams

  const collection = await getCollectionByHandle(params.handle).then(
    (collection: StoreCollection) => collection
  )

  if (!collection) {
    const category = findBrowseCategory(["collections", params.handle])
    if (!category) {
      notFound()
    }
    const requested = parseInt(searchParams.show ?? "", 10)
    return (
      <BrowseTemplate
        category={category}
        sort={resolveBrowseSort(searchParams.sort)}
        show={Number.isFinite(requested) && requested > 0 ? requested : PAGE_SIZE}
        selection={selectionFromParams(searchParams as any)}
        countryCode={params.countryCode}
      />
    )
  }

  return (
    <CollectionTemplate
      collection={collection}
      page={page}
      sortBy={sortBy}
      countryCode={params.countryCode}
    />
  )
}
