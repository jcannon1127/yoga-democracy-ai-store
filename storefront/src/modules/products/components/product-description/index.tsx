import { Heading, Text } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"

/**
 * The "Description" section, full width below the two columns — where the live page puts it.
 *
 * Live copy runs to three or four paragraphs and includes the fabric content ("79% Recycled
 * PET / 21% LYCRA XTRALIFE") and the "Meant to move. Sustainable." tagline, so paragraph
 * breaks are preserved rather than collapsed into one block.
 *
 * Renders nothing when there is no description. Today that is every product — the catalogue
 * import brought over titles, prices, sizes and images but not copy, so `description` is
 * null on all 552. An empty "Description" heading over blank space looks broken; no section
 * simply looks like a shorter page. The gap is real and belongs to the catalogue, not here.
 */
const ProductDescription = ({ product }: { product: HttpTypes.StoreProduct }) => {
  const description = product.description?.trim()

  if (!description) {
    return null
  }

  const paragraphs = description.split(/\n{2,}|\r\n\r\n/).filter((p) => p.trim())

  return (
    <section className="content-container py-10" data-testid="product-description-section">
      <Heading level="h2" className="text-2xl font-normal text-ui-fg-base mb-4">
        Description
      </Heading>
      <div className="flex flex-col gap-y-4 max-w-3xl">
        {paragraphs.map((paragraph, i) => (
          <Text
            key={i}
            className="text-ui-fg-subtle leading-7 whitespace-pre-line"
            data-testid="product-description"
          >
            {paragraph.trim()}
          </Text>
        ))}
      </div>
    </section>
  )
}

export default ProductDescription
