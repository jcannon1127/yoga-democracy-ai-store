import { MetadataRoute } from "next"

import { SITE_IS_PUBLIC } from "@lib/constants/indexing"
import { getBaseURL } from "@lib/util/env"

/**
 * Both this and the `robots` metadata in src/app/layout.tsx read the SAME switch, so the
 * preview lock cannot be half-lifted. See src/lib/constants/indexing.ts for why both exist.
 *
 * The sitemap is advertised only when the site is public: pointing crawlers at a list of
 * URLs we are simultaneously telling them not to crawl is a contradiction, and the sitemap
 * is how the new addresses get discovered on the day it stops being one.
 */
export default function robots(): MetadataRoute.Robots {
  if (!SITE_IS_PUBLIC) {
    return { rules: [{ userAgent: "*", disallow: "/" }] }
  }

  const base = getBaseURL().replace(/\/$/, "")
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Matches the live site's exclusions: nothing a crawler should spend budget on and
        // nothing that should ever appear in a result.
        disallow: ["/*/account", "/*/checkout", "/*/cart", "/*/order"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
