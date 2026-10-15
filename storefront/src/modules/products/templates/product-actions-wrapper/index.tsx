import React from "react"

import { listProducts } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"
import { SaleCallout } from "@lib/util/sale-callout"
import ProductActions from "@modules/products/components/product-actions"

/**
 * Fetches real time pricing for a product and renders the product actions component.
 */
export default async function ProductActionsWrapper({
  id,
  region,
  sizeChart,
  backorderMessage,
  saleCallouts,
}: {
  id: string
  region: HttpTypes.StoreRegion
  /** Server-rendered, passed through so the size chart never enters the client bundle. */
  sizeChart?: React.ReactNode
  backorderMessage?: string
  saleCallouts?: SaleCallout[]
}) {
  const product = await listProducts({
    queryParams: { id: [id] },
    regionId: region.id,
  }).then(({ response }) => response.products[0])

  if (!product) {
    return null
  }

  return (
    <ProductActions
      product={product}
      region={region}
      sizeChart={sizeChart}
      backorderMessage={backorderMessage}
      saleCallouts={saleCallouts}
    />
  )
}
