import { Heading, Text } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { listProducts } from "@lib/data/products"
import ProductPreview from "@modules/products/components/product-preview"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * Products on the front page.
 *
 * The starter's homepage renders `FeaturedProducts`, which lists *collections* — and this
 * catalog has none, so the front door was a hero and nothing else. The photography is the
 * most convincing thing we have; it should not take a click to see it.
 *
 * Products without a thumbnail are skipped rather than rendered as grey boxes: image
 * coverage is 94%, so a plain `limit: 12` would put a placeholder in the shop window.
 */
export default async function FeaturedGrid({
  countryCode,
  region,
  limit = 12,
}: {
  countryCode: string
  region: HttpTypes.StoreRegion
  limit?: number
}) {
  // Over-fetch so that skipping the thumbnail-less ones still fills the grid.
  const {
    response: { products },
  } = await listProducts({
    countryCode,
    queryParams: { limit: limit * 3 },
  })

  const withImages = products.filter((p) => !!p.thumbnail).slice(0, limit)

  if (!withImages.length) {
    return null
  }

  return (
    <div className="content-container py-12 small:py-24">
      <div className="flex flex-col small:flex-row small:items-end justify-between mb-8 gap-2">
        <div className="flex flex-col gap-1">
          <Heading level="h2" className="text-2xl-semi text-ui-fg-base">
            New in
          </Heading>
          <Text className="text-ui-fg-subtle">
            Printed and sewn at our own factory in Kenya.
          </Text>
        </div>
        <LocalizedClientLink
          href="/store"
          className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover txt-medium"
        >
          View all →
        </LocalizedClientLink>
      </div>

      <ul className="grid grid-cols-2 small:grid-cols-3 medium:grid-cols-4 gap-x-6 gap-y-10">
        {withImages.map((product) => (
          <li key={product.id}>
            <ProductPreview product={product} region={region} isFeatured />
          </li>
        ))}
      </ul>
    </div>
  )
}
