import { MetadataRoute } from "next"

import { getCatalogue } from "@lib/data/products"
import { allBrowseCategories, browseHref } from "@lib/util/browse-categories"
import { getBaseURL } from "@lib/util/env"
import { DEFAULT_REGION, productPath, regionPath } from "@lib/util/product-url"
import { listContentPageSlugs } from "@lib/content/pages"

/**
 * The sitemap.
 *
 * There was not one. `/sitemap.xml` returned 200 with the app's HTML, which is the worst
 * of both: a check that fetches it and looks at the status code passes, and a crawler gets
 * a web page where it asked for XML.
 *
 * It matters most at exactly one moment. At cutover Google has to find ~600 URLs that have
 * just moved, and 1,299 redirects only help for URLs it already knows and re-crawls. A
 * sitemap is how the NEW addresses get discovered rather than waited for.
 *
 * Built from the same helpers the pages use -- `productPath()`, `browseHref()` -- rather than
 * from a second list of paths. That matters more than it looks here: `productPath()` already
 * honours NEXT_PUBLIC_DEFAULT_REGION_BARE_PATH, so when the `/us/` prefix question is
 * settled the sitemap follows the canonical automatically instead of needing to be
 * remembered. A sitemap that disagrees with the canonical tag is worse than none: it asks a
 * crawler to index one address while the page says its address is another.
 *
 * NOTE this is not served while the preview lock is on -- robots.ts disallows everything and
 * only advertises the sitemap once YD_PUBLIC_SITE is set. It is built now so that it is
 * correct on the day it is needed rather than written in a hurry that morning.
 */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseURL().replace(/\/$/, "")
  const region = DEFAULT_REGION
  const now = new Date()

  // Named `prefixed` when there was always a prefix. It now emits whichever shape is
  // canonical, from the same helper the canonical tags use.
  const prefixed = (path: string) => `${base}${regionPath(region, path)}`

  const entries: MetadataRoute.Sitemap = [
    { url: prefixed("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: prefixed("/store"), lastModified: now, changeFrequency: "daily", priority: 0.9 },
  ]

  for (const category of allBrowseCategories()) {
    entries.push({
      url: prefixed(browseHref(category)),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    })
  }

  for (const slug of listContentPageSlugs()) {
    entries.push({
      url: prefixed(`/pages/${slug}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    })
  }

  // Products last and deliberately tolerant: if Medusa is unreachable at build time we still
  // want a sitemap listing everything else, not a build failure or an empty file. An
  // incomplete sitemap costs discovery speed; a missing one costs all of it.
  try {
    for (const product of await getCatalogue(region)) {
      if (!product.handle) continue
      entries.push({
        url: `${base}${productPath(region, product.handle)}`,
        lastModified: product.updated_at ? new Date(product.updated_at) : now,
        changeFrequency: "weekly",
        priority: 0.7,
      })
    }
  } catch (error) {
    console.error("YD_SITEMAP_PARTIAL products unavailable; sitemap omits them", error)
  }

  return entries
}
