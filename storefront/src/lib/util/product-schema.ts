import { HttpTypes } from "@medusajs/types"

import { STORE_NAME } from "@lib/constants/store"
import { getAvailability, isBackorder, isOrderable } from "@lib/util/availability"
import { Crumb } from "@lib/util/breadcrumbs"
import { getPricesForVariant } from "@lib/util/get-product-price"
import { regionPath } from "@lib/util/product-url"

/**
 * Product structured data (schema.org/Product) for the PDP.
 *
 * Why it is worth having: rich results put price and availability directly in the search
 * listing. The live SFCC site emits a single EMPTY `application/ld+json` block on every
 * product page -- verified in a browser, so it is not a case of JavaScript filling it in
 * later -- which means YD currently gets none of that. This is the one part of the SEO
 * surface where the migration can be straightforwardly better than what it replaces rather
 * than merely equal.
 *
 * The hard rule here is that everything below must match what the page actually shows.
 * Structured data that disagrees with the visible page is worse than none: it is the
 * category of thing Google issues manual actions for. So:
 *  - price comes from getPricesForVariant(), the same helper that renders the price
 *  - availability comes from isOrderable()/isBackorder(), the same helpers that decide
 *    whether Add to Cart is enabled -- not from a separate reading of inventory
 *  - no aggregateRating. Reviews are fetched client-side from Yotpo and we have no rating
 *    server-side; inventing one, or shipping a rating we have not read, is exactly the
 *    misrepresentation this comment is warning about.
 */
export const productJsonLd = (
  product: HttpTypes.StoreProduct,
  canonicalUrl: string,
  baseUrl: string
) => {
  const absolute = (url?: string | null) => {
    if (!url) return undefined
    return url.startsWith("http") ? url : `${baseUrl.replace(/\/$/, "")}${url}`
  }

  const images = (product.images ?? [])
    .map((i) => absolute(i.url))
    .filter((u): u is string => !!u)

  const thumbnail = absolute(product.thumbnail)
  if (thumbnail && !images.includes(thumbnail)) {
    images.unshift(thumbnail)
  }

  // One Offer per variant, because price and availability genuinely differ by size.
  const offers = (product.variants ?? [])
    .map((variant) => {
      const prices = getPricesForVariant(variant)
      if (!prices) return null

      const known = getAvailability(variant)
      const availability =
        known === "unknown"
          ? undefined
          : !isOrderable(variant)
            ? "https://schema.org/OutOfStock"
            : isBackorder(variant)
              ? "https://schema.org/BackOrder"
              : "https://schema.org/InStock"

      return {
        "@type": "Offer",
        sku: variant.sku ?? undefined,
        name: variant.title ?? undefined,
        price: prices.calculated_price_number,
        priceCurrency: prices.currency_code?.toUpperCase(),
        availability,
        url: canonicalUrl,
        itemCondition: "https://schema.org/NewCondition",
        seller: { "@type": "Organization", name: STORE_NAME },
      }
    })
    .filter(Boolean)

  if (!offers.length) return null

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description ?? undefined,
    image: images.length ? images : undefined,
    sku: product.variants?.[0]?.sku ?? undefined,
    brand: { "@type": "Brand", name: STORE_NAME },
    url: canonicalUrl,
    offers,
  }
}

/**
 * schema.org/BreadcrumbList for the PDP, from the SAME crumbs the visible breadcrumb renders.
 *
 * Note the visible trail stops at the category and does not repeat the product -- so this
 * does too. Adding a final crumb here that is not on the page would be the exact disagreement
 * the shared source exists to prevent, even though a product-final trail is the more common
 * convention.
 */
export const breadcrumbJsonLd = (
  crumbs: Crumb[],
  baseUrl: string,
  countryCode: string
) => {
  if (crumbs.length < 2) return null

  const root = baseUrl.replace(/\/$/, "")
  const href = (path: string) => `${root}${regionPath(countryCode, path)}`

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: href(crumb.href),
    })),
  }
}

/**
 * schema.org/Organization for the homepage.
 *
 * Built from site-chrome.json -- the same file the header logo and the footer's social links
 * render from -- so the profiles we claim as ours are the profiles we actually link to. Same
 * rule as the Product and BreadcrumbList markup: one source, not a second hand-written list
 * that drifts the first time a social account changes.
 *
 * `sameAs` is the load-bearing part. It is how a search engine ties yogademocracy.com to the
 * Instagram and Facebook accounts it already knows, which is what a knowledge panel is built
 * from. Verified against the live site: the same five profiles, no more.
 */
export const organizationJsonLd = (
  chrome: {
    logo?: { src?: string } | null
    social?: { label?: string; href?: string }[] | null
  },
  baseUrl: string
) => {
  const root = baseUrl.replace(/\/$/, "")
  const logo = chrome.logo?.src
  const sameAs = (chrome.social ?? [])
    .map((s) => s.href)
    .filter((h): h is string => !!h && h.startsWith("http"))

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: STORE_NAME,
    url: root,
    ...(logo
      ? { logo: logo.startsWith("http") ? logo : `${root}${logo}` }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }
}
