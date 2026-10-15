import { HttpTypes } from "@medusajs/types"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

interface MinPricedProduct extends HttpTypes.StoreProduct {
  _minPrice?: number
}

/**
 * Helper function to sort products by price until the store API supports sorting by price
 * @param products
 * @param sortBy
 * @returns products sorted by price
 */
export function sortProducts(
  products: HttpTypes.StoreProduct[],
  sortBy: SortOptions
): HttpTypes.StoreProduct[] {
  let sortedProducts = products as MinPricedProduct[]

  if (["price_asc", "price_desc"].includes(sortBy)) {
    // Precompute the minimum price for each product
    sortedProducts.forEach((product) => {
      if (product.variants && product.variants.length > 0) {
        product._minPrice = Math.min(
          ...product.variants.map(
            (variant) => variant?.calculated_price?.calculated_amount || 0
          )
        )
      } else {
        product._minPrice = Infinity
      }
    })

    // Sort products based on the precomputed minimum prices
    sortedProducts.sort((a, b) => {
      const diff = a._minPrice! - b._minPrice!
      return sortBy === "price_asc" ? diff : -diff
    })
  }

  if (sortBy === "created_at") {
    sortedProducts.sort((a, b) => {
      return (
        new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime()
      )
    })
  }

  // Photographed products first, whatever the chosen sort.
  //
  // 6 of 100 products have no image — they are discontinued or seasonal and have no live
  // SFCC page left to harvest one from, so they stay blank until someone shoots them. Two
  // were landing in the first row, and an empty tile in the first row reads as "the site is
  // broken" to anyone who does not know why.
  //
  // They are sorted to the end rather than filtered out: the preview should show all 100
  // and be honest that six lack photography, not quietly show 94 and imply that is the
  // catalog. Array.prototype.sort is stable, so the sort chosen above still decides the
  // order *within* each group.
  //
  // This runs before pagination (see listProductsWithSort, which fetches all 100 and then
  // slices), so the blanks land on the last page rather than at the foot of every page.
  sortedProducts.sort(
    (a, b) => Number(Boolean(b.thumbnail)) - Number(Boolean(a.thumbnail))
  )

  return sortedProducts
}
