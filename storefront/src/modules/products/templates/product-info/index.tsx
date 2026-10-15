import { HttpTypes } from "@medusajs/types"
import { Heading } from "@medusajs/ui"

import ProductRating from "@modules/products/components/product-rating"

/**
 * Product name and rating — the top of the live page's right-hand column.
 *
 * The starter also printed the collection name above the title and the whole description
 * below it. Neither belongs here: this catalogue has no collections (0 in Medusa), and the
 * live page carries its description full-width below both columns under a "Description"
 * heading, not squeezed into the buy box. Both moved rather than deleted.
 */
const ProductInfo = ({
  product,
  countryCode,
}: {
  product: HttpTypes.StoreProduct
  countryCode: string
}) => (
  <div id="product-info" className="flex flex-col gap-y-2">
    <Heading
      level="h1"
      // Live's own sizes and breakpoint — see `.yd-product-title` in globals.css.
      className="yd-product-title"
      data-testid="product-title"
    >
      {product.title}
    </Heading>
    <div className="flex justify-end min-h-[1rem]">
      <ProductRating product={product} countryCode={countryCode} />
    </div>
  </div>
)

export default ProductInfo
