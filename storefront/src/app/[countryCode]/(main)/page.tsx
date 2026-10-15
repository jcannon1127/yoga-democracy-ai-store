import { Metadata } from "next"

import CategoryTiles from "@modules/home/components/category-tiles"
import FeaturedGrid from "@modules/home/components/featured-grid"
import Hero from "@modules/home/components/hero"
import { getRegion } from "@lib/data/regions"
import { STORE_NAME } from "@lib/constants/store"
import { organizationJsonLd } from "@lib/util/product-schema"
import { readSiteChrome } from "@lib/content/site-chrome"
import { getBaseURL } from "@lib/util/env"

export const metadata: Metadata = {
  title: { absolute: STORE_NAME },
  description:
    "Eco-friendly yoga apparel, printed and sewn in our own factory.",
}

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params

  const { countryCode } = params

  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  // schema.org/Organization -- from site-chrome.json, the same file the header logo and the
  // footer's social links render from, so the profiles we claim are the profiles we link to.
  const orgLd = organizationJsonLd(readSiteChrome(), getBaseURL())

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
      />
      <Hero />
      <CategoryTiles />
      <FeaturedGrid countryCode={countryCode} region={region} />
    </>
  )
}
