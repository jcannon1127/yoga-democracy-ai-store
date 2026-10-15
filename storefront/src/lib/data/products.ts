"use server"

import { sdk } from "@lib/config"
import { sortProducts } from "@lib/util/sort-products"
import { HttpTypes } from "@medusajs/types"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import { getAuthHeaders, getCacheOptions } from "./cookies"
import { getRegion, retrieveRegion } from "./regions"

/** Identical product queries are collapsed for this long. Short: prices must stay current. */
const PRODUCT_QUERY_TTL_MS = 30_000
const productQueryMemo = new Map<
  string,
  { at: number; promise: Promise<any> }
>()

/** Bound the memo so a long-lived process cannot accumulate query keys without limit. */
const MAX_MEMO_ENTRIES = 200
const rememberQuery = (key: string, promise: Promise<any>) => {
  if (productQueryMemo.size >= MAX_MEMO_ENTRIES) {
    const oldest = productQueryMemo.keys().next().value
    if (oldest) productQueryMemo.delete(oldest)
  }
  productQueryMemo.set(key, { at: Date.now(), promise })
  promise.catch(() => productQueryMemo.delete(key))
}

export const listProducts = async ({
  pageParam = 1,
  queryParams,
  countryCode,
  regionId,
}: {
  pageParam?: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
  countryCode?: string
  regionId?: string
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
}> => {
  if (!countryCode && !regionId) {
    throw new Error("Country code or region ID is required")
  }

  const limit = queryParams?.limit || 12
  const _pageParam = Math.max(pageParam, 1)
  const offset = _pageParam === 1 ? 0 : (_pageParam - 1) * limit

  let region: HttpTypes.StoreRegion | undefined | null

  if (countryCode) {
    region = await getRegion(countryCode)
  } else {
    region = await retrieveRegion(regionId!)
  }

  if (!region) {
    return {
      response: { products: [], count: 0 },
      nextPage: null,
    }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("products")),
    // Time-bound the product cache.
    //
    // The starter caches product fetches with `force-cache` and tags, but nothing ever calls
    // revalidateTag on the products tag — only a locale change does. `next build` also reuses
    // .next/cache/fetch-cache BETWEEN builds, so a rebuild happily re-serves product JSON
    // captured before the catalogue changed. Prices, descriptions and metadata updated in
    // Medusa never reach a customer, nothing errors, and the site simply shows an older
    // catalogue. A shop that cannot be told its prices have changed is an operational
    // hazard, not a build annoyance.
    //
    // Five minutes: short enough that a price fix is live without a deploy, long enough that
    // a listing page is not refetching the catalogue per visitor.
    revalidate: 300,
  }

  // `*categories` is here for the product page's breadcrumb (Home / Shop / Bottoms). It is
  // a handful of bytes per product and the alternative — a second fields list on the PDP —
  // means two copies of this string drifting apart. (yd-pdp)
  const FIELDS_WITH_STOCK =
    "*variants.calculated_price,+variants.inventory_quantity,*variants.images,*categories,+metadata,+tags,"
  // Same fields minus inventory. Medusa can only report stock when the publishable key
  // resolves to exactly ONE sales channel; if it resolves to several, "how many are in
  // stock" has no answer and it rejects the WHOLE request with a 400 — taking prices,
  // images and titles down with it.
  const FIELDS_WITHOUT_STOCK =
    "*variants.calculated_price,*variants.images,*categories,+metadata,+tags,"

  const query = (fields: string) => ({
    limit,
    offset,
    region_id: region?.id,
    fields,
    ...queryParams,
  })

  const request = (fields: string) =>
    sdk.client.fetch<{ products: HttpTypes.StoreProduct[]; count: number }>(
      `/store/products`,
      { method: "GET", query: query(fields), headers, next, cache: "force-cache" }
    )

  /**
   * Collapse identical product queries.
   *
   * Four different components each asked for the same first 12 products on a single render
   * of /us/store, and every render repeated them. Next's fetch cache was not deduplicating
   * (the incident that put Medusa at 26s per query), so this is done here where it can be
   * verified by counting requests in medusa.log.
   *
   * Keyed on the exact query, so a different page or filter is a different entry. Products
   * only — carts and customers are never cached this way, and must not be.
   */
  const memoKey = JSON.stringify(query(FIELDS_WITH_STOCK))
  const memoized = productQueryMemo.get(memoKey)
  if (memoized && Date.now() - memoized.at < PRODUCT_QUERY_TTL_MS) {
    return memoized.promise
  }

  const result = request(FIELDS_WITH_STOCK)
    .catch((err: any) => {
      // A misconfigured sales channel is an operational problem, not a reason for the shop
      // to disappear. This has now caused two outages: product pages 500 and the listing
      // renders "Page not found", which looks nothing like its cause. Serve the catalogue
      // without stock figures instead — the UI already has an honest third state for that
      // ("availability unknown"), so nothing claims stock it cannot verify.
      const message = err?.message ?? ""
      if (!/single sales channel/i.test(message)) {
        throw err
      }
      console.error(
        "[storefront] Medusa refused inventory: the publishable key resolves to more " +
          "than one sales channel. Serving the catalogue with availability unknown. " +
          "Fix: link the key to exactly one sales channel."
      )
      return request(FIELDS_WITHOUT_STOCK)
    })
    .then(({ products, count }) => {
      const nextPage = count > offset + limit ? pageParam + 1 : null

      return {
        response: {
          products,
          count,
        },
        nextPage: nextPage,
        queryParams,
      }
    })

  // Never let a failure sit in the cache as though it were an answer (rememberQuery
  // clears it on rejection).
  rememberQuery(memoKey, result)

  // Survive a backend restart on the path PRODUCT PAGES actually use.
  //
  // The catalogue-level fallback above only covers listing/browse/search, which call
  // getCatalogue. A product page fetches by handle through here, so during a Medusa restart
  // it 500'd while the listings stayed up — proven by pointing an isolated build at a
  // stoppable proxy and killing it: store 200, product 500. Serving a slightly stale product
  // page beats serving a stack trace, and every backend deploy is otherwise a full outage.
  //
  // Deliberately narrow: only when a specific handle was requested, and only from a
  // catalogue we previously fetched successfully. Carts and customers are never served stale.
  return result.catch((error) => {
    const handle = (queryParams as any)?.handle
    const cached = lastGoodCatalogue?.products.find((p) => p.handle === handle)
    if (handle && cached) {
      const ageSeconds = Math.round((Date.now() - (lastGoodCatalogue?.at ?? 0)) / 1000)
      console.error(
        `[storefront] Medusa unreachable; serving last-known-good product "${handle}" ` +
          `(${ageSeconds}s old)`,
        error
      )
      // Must match listProducts' own return shape. The first version returned the raw
      // `{ products, count }` and the caller destructures `{ response }`, so the fallback
      // threw and the page 500'd anyway — the resilience code ran and made no difference.
      // Only a product page that had NEVER been rendered before the outage exposed it:
      // every warmed page was being served by a cache, not by this.
      return {
        response: { products: [cached], count: 1 },
        nextPage: null,
        queryParams,
      } as any
    }
    throw error
  })
}

/**
 * This will fetch 100 products to the Next.js cache and sort them based on the sortBy parameter.
 * It will then return the paginated products based on the page and limit parameters.
 */
/**
 * The whole catalogue, fetched at most once a minute per process.
 *
 * INCIDENT 2026-08-23: one render of /us/store issued **285** `/store/products` requests and
 * Medusa went to 26s per query while /health stayed green. Cause: several components each
 * walk the catalogue (store listing, browse pages, search), each walk is 6 paged requests,
 * and Next's fetch cache was not deduplicating them — every render refetched everything.
 *
 * A module-level memo fixes it at the only layer that can: one walk serves every component
 * on the page and every visitor for the next minute. 60 seconds is short enough that a price
 * or stock change appears promptly and long enough that a burst of traffic cannot stampede
 * the backend.
 *
 * The in-flight promise is shared too, so ten simultaneous requests during a cold cache
 * produce ONE walk rather than ten — that stampede is what turned a slow page into an
 * unusable one.
 */
const CATALOGUE_TTL_MS = 60_000
let catalogueMemo: {
  key: string
  at: number
  promise: Promise<HttpTypes.StoreProduct[]>
} | null = null

/**
 * The last catalogue we successfully fetched, kept indefinitely.
 *
 * Every backend deploy is currently a full-site outage: Medusa restarts, the fetch throws
 * ECONNREFUSED, and every product page 500s. That surfaced when a sweep measured 75 product
 * pages failing and nearly filed a catalogue-wide regression — the pages were fine, Medusa
 * had been stopped and started three times in five minutes by another lane. With several
 * lanes about to deploy backend code, a shop that cannot survive its own backend restarting
 * is a shop that goes dark on every deploy.
 *
 * Serving a slightly stale catalogue during a restart is the right trade for a browsing
 * page: the alternative is a 500. It is NOT the right trade for the cart or checkout, which
 * must never operate on stale state and are deliberately untouched.
 */
let lastGoodCatalogue: { key: string; at: number; products: HttpTypes.StoreProduct[] } | null =
  null

export const getCatalogue = async (
  countryCode: string
): Promise<HttpTypes.StoreProduct[]> => {
  const now = Date.now()
  if (catalogueMemo && catalogueMemo.key === countryCode && now - catalogueMemo.at < CATALOGUE_TTL_MS) {
    return catalogueMemo.promise
  }

  const promise = (async () => {
    const PAGE = 100
    const MAX_PRODUCTS = 5000
    const first = await listProducts({
      pageParam: 1,
      queryParams: { ...(undefined as any), limit: PAGE },
      countryCode,
    })
    const products = [...first.response.products]
    const count = first.response.count
    for (let page = 2; products.length < Math.min(count, MAX_PRODUCTS); page++) {
      const next = await listProducts({
        pageParam: page,
        queryParams: { limit: PAGE },
        countryCode,
      })
      if (!next.response.products.length) break
      products.push(...next.response.products)
    }
    return products
  })()

  catalogueMemo = { key: countryCode, at: now, promise }

  promise
    .then((products) => {
      if (products.length) {
        lastGoodCatalogue = { key: countryCode, at: Date.now(), products }
      }
    })
    .catch(() => {
      // A failed walk must not be cached as the answer for a minute.
      if (catalogueMemo?.promise === promise) catalogueMemo = null
    })

  // If the backend is unreachable, serve the last catalogue we did get rather than failing
  // the page. Loud, because "stale by three minutes" and "stale by three days" look the same
  // to a customer and are completely different to us.
  return promise.catch((error) => {
    if (lastGoodCatalogue && lastGoodCatalogue.key === countryCode) {
      const ageSeconds = Math.round((Date.now() - lastGoodCatalogue.at) / 1000)
      console.error(
        "[storefront] Medusa unreachable; serving last-known-good catalogue " +
          `(${lastGoodCatalogue.products.length} products, ${ageSeconds}s old)`,
        error
      )
      return lastGoodCatalogue.products
    }
    throw error
  })
}

export const listProductsWithSort = async ({
  page = 0,
  queryParams,
  sortBy = "created_at",
  countryCode,
}: {
  page?: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
  sortBy?: SortOptions
  countryCode: string
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
}> => {
  const limit = queryParams?.limit || 12

  const products = await getCatalogue(countryCode)
  const count = products.length

  const sortedProducts = sortProducts(products, sortBy)

  const pageParam = (page - 1) * limit

  const nextPage = count > pageParam + limit ? pageParam + limit : null

  const paginatedProducts = sortedProducts.slice(pageParam, pageParam + limit)

  return {
    response: {
      products: paginatedProducts,
      count,
    },
    nextPage,
    queryParams,
  }
}
