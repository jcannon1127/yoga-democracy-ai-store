import { Text } from "@medusajs/ui"
import { listProducts } from "@lib/data/products"
import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "../thumbnail"
import PreviewPrice from "./price"

export default async function ProductPreview({
  product,
  isFeatured,
  region,
}: {
  product: HttpTypes.StoreProduct
  isFeatured?: boolean
  region: HttpTypes.StoreRegion
}) {
  // const pricedProduct = await listProducts({
  //   regionId: region.id,
  //   queryParams: { id: [product.id!] },
  // }).then(({ response }) => response.products[0])

  // if (!pricedProduct) {
  //   return null
  // }

  const { cheapestPrice } = getProductPrice({
    product,
  })

  return (
    <LocalizedClientLink href={`/products/${product.handle}`} className="group">
      <div data-testid="product-wrapper">
        {/* Matched to the live site's product tile: the photograph at its own 2:3 ratio with
            no frame around it, then the name, then the price beneath — not name and price on
            one row. The live tile also carries a Yotpo star rating; reviews are yd-pdp's and
            are not wired yet, so it is absent rather than faked. */}
        <Thumbnail
          thumbnail={product.thumbnail}
          images={product.images}
          size="full"
          isFeatured={isFeatured}
          variant="bare"
          aspect="aspect-[2/3]"
        />
        {/* Centred, as on the live site: name on its own line, price beneath. */}
        <div className="flex flex-col items-center text-center txt-compact-medium mt-3 gap-y-1">
          <Text className="text-ui-fg-base" data-testid="product-title">
            {product.title}
          </Text>
          <div className="flex items-center justify-center gap-x-2">
            {cheapestPrice && <PreviewPrice price={cheapestPrice} />}
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
