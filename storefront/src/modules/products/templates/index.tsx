import React, { Suspense } from "react"

import ImageGallery from "@modules/products/components/image-gallery"
import ProductActions from "@modules/products/components/product-actions"
import CompleteTheSet from "@modules/products/components/complete-the-set"
import ProductBreadcrumb from "@modules/products/components/product-breadcrumb"
import ProductDescription from "@modules/products/components/product-description"
import ProductReviews from "@modules/products/components/product-reviews"
import RelatedProducts from "@modules/products/components/related-products"
import SizeChart from "@modules/products/components/size-chart"
import ProductInfo from "@modules/products/templates/product-info"
import SkeletonRelatedProducts from "@modules/skeletons/templates/skeleton-related-products"
import { notFound } from "next/navigation"
import { HttpTypes } from "@medusajs/types"

import { backorderMessage, saleCallouts } from "@lib/content/site-chrome"

import ProductActionsWrapper from "./product-actions-wrapper"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  countryCode: string
  images: HttpTypes.StoreProductImage[]
}

/**
 * The product page, laid out the way yogademocracy.com lays it out.
 *
 * Live order, and therefore this order: breadcrumb; then two columns, gallery on the left
 * and everything you act on stacked in a single column on the right (name, rating, size,
 * length, quantity, size chart, availability, price, Add to Cart, Complete the Set); then,
 * full width below both, the description; then recommendations.
 *
 * The starter used **three** columns — title and spec accordion on the left, gallery in the
 * middle, buy box on the right — which splits the buying decision across the full width of
 * the screen and puts the price as far from the product name as the layout allows. It also
 * shipped a "Product Information" accordion of Material / Country of origin / Type, every
 * row of which renders "-" on this catalogue. Both are gone.
 *
 * What is deliberately missing, and why, is documented at the components: no wishlist
 * (dropped for launch), no promotions callout (deferred), no Einstein recommendation rail
 * (does not migrate), no back-in-stock notify and no free-hemming callout (neither exists
 * on the live page — the charter was wrong about hemming).
 */
const ProductTemplate: React.FC<ProductTemplateProps> = ({
  product,
  region,
  countryCode,
  images,
}) => {
  if (!product || !product.id) {
    return notFound()
  }

  // Read once per render rather than per component — it is a file read, and both the
  // suspense fallback and the real actions need the same string.
  const backorderCopy = backorderMessage()
  const callouts = saleCallouts()

  return (
    <>
      {/* Room for the sticky mobile buy bar, which is `fixed` and otherwise sits on top of
          whatever is at the bottom of the page — the availability line, in a 390px
          screenshot. Only needed below md, where the bar exists. */}
      <div className="content-container pb-24 md:pb-0" data-testid="product-container">
        <ProductBreadcrumb product={product} />

        {/* Column widths mirror the live page's Bootstrap classes rather than being picked
            by eye: images are `col-12 col-md-7 col-lg-5` and the details column is
            `col-12 col-md-5`. So one column on a phone, a 7/5 split from 768px where the
            image takes the larger share, and an even 5/5 from 1024px. The starter split at
            1024px only, which left tablets in portrait showing a single stacked column
            where the live site already shows two. */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-x-8 gap-y-8 pb-8">
          {/* Full-bleed on a phone, inset from md up.
              Verified against a 390px screenshot of the live page rather than inferred: the
              live gallery runs edge to edge on mobile, and `content-container` adds px-6, so
              ours was sitting in a 24px gutter on both sides and showing a visibly smaller
              garment. The negative margin cancels the container padding below md, where the
              image is the whole width anyway; from md the column layout takes over and the
              inset is correct. */}
          <div className="md:col-span-7 lg:col-span-5 -mx-6 md:mx-0">
            <ImageGallery images={images} title={product.title} />
          </div>

          <div className="md:col-span-5 flex flex-col gap-y-6">
            <ProductInfo product={product} countryCode={countryCode} />

            <Suspense
              fallback={
                <ProductActions
                  disabled={true}
                  product={product}
                  region={region}
                  sizeChart={<SizeChart />}
                  backorderMessage={backorderCopy}
                  saleCallouts={callouts}
                />
              }
            >
              <ProductActionsWrapper
                id={product.id}
                region={region}
                sizeChart={<SizeChart />}
                backorderMessage={backorderCopy}
                saleCallouts={callouts}
              />
            </Suspense>

            {/* Colourway cross-sell. Walks the catalogue, so it must never hold up the
                buy box — it streams in behind its own boundary. */}
            <Suspense fallback={null}>
              <CompleteTheSet product={product} countryCode={countryCode} />
            </Suspense>
          </div>
        </div>
      </div>

      <ProductDescription product={product} />

      <div
        className="content-container my-16 small:my-32"
        data-testid="related-products-container"
      >
        <Suspense fallback={<SkeletonRelatedProducts />}>
          <RelatedProducts product={product} countryCode={countryCode} />
        </Suspense>
      </div>

      {/* Live order is description, then the recommendation rail, then reviews. The rail
          there is Einstein, which does not migrate; RelatedProducts stands in its place. */}
      <ProductReviews product={product} countryCode={countryCode} />
    </>
  )
}

export default ProductTemplate
