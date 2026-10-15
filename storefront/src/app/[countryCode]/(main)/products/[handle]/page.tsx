import { Metadata } from "next"
import { notFound } from "next/navigation"
import { listProducts } from "@lib/data/products"
import { getRegion, listRegions } from "@lib/data/regions"
import ProductTemplate from "@modules/products/templates"
import { HttpTypes } from "@medusajs/types"
import { STORE_NAME } from "@lib/constants/store"
import { getBaseURL } from "@lib/util/env"
import { productUrl } from "@lib/util/product-url"
import { breadcrumbJsonLd, productJsonLd } from "@lib/util/product-schema"
import { productBreadcrumbs } from "@lib/util/breadcrumbs"

/**
 * The `<meta name="description">` for a product.
 *
 * The starter repeated the product title, which gives Google nothing to show and wastes the
 * one piece of copy that appears in every search result. The live page carries a real
 * 150-character description, so repeating the title is a measurable regression, not a
 * cosmetic one.
 *
 * Uses the product's own copy where it exists. It does not exist yet — `description` is null
 * on every imported product, and the 8/17 Salesforce export does not contain copy either, so
 * the live storefront is currently the only place YD's product copy exists at all
 * (yd-features is rescuing it). Until that lands, the fallback is deliberately a plain,
 * checkable claim about the brand rather than invented marketing copy for a garment nobody
 * here has seen.
 */
const metaDescription = (product: HttpTypes.StoreProduct) => {
  const copy = product.description?.replace(/\s+/g, " ").trim()

  if (copy) {
    return copy.length > 155 ? `${copy.slice(0, 152).trimEnd()}...` : copy
  }

  return `${product.title} from ${STORE_NAME}. Eco-friendly activewear made from recycled materials.`
}

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
  searchParams: Promise<{ v_id?: string }>
}

export async function generateStaticParams() {
  try {
    const countryCodes = await listRegions().then((regions) =>
      regions?.map((r) => r.countries?.map((c) => c.iso_2)).flat()
    )

    if (!countryCodes) {
      return []
    }

    const promises = countryCodes.map(async (country) => {
      const { response } = await listProducts({
        countryCode: country,
        queryParams: { limit: 100, fields: "handle" },
      })

      return {
        country,
        products: response.products,
      }
    })

    const countryProducts = await Promise.all(promises)

    return countryProducts
      .flatMap((countryData) =>
        countryData.products.map((product) => ({
          countryCode: countryData.country,
          handle: product.handle,
        }))
      )
      .filter((param) => param.handle)
  } catch (error) {
    console.error(
      `Failed to generate static paths for product pages: ${
        error instanceof Error ? error.message : "Unknown error"
      }.`
    )
    return []
  }
}

/**
 * The images to show for the variant in `?v_id=`, falling back to the product's own set.
 *
 * Every access here is guarded, and that is not defensive tidying: `variant.images` is
 * optional on `StoreProduct`, and `variant.images.length` on a variant without them throws
 * — a hard 500 on a product page, reached by the deep links the size dropdown itself writes.
 * TypeScript flagged all three; `ignoreBuildErrors` in next.config.js was hiding them, and
 * the non-null assertions (`!`) were silencing the rest.
 *
 * Always returns an array, never null, so callers do not each have to re-check.
 */
function getImagesForVariant(
  product: HttpTypes.StoreProduct,
  selectedVariantId?: string
): HttpTypes.StoreProductImage[] {
  const productImages = product.images ?? []

  if (!selectedVariantId || !product.variants) {
    return productImages
  }

  const variant = product.variants.find((v) => v.id === selectedVariantId)
  const variantImages = variant?.images ?? []

  if (!variantImages.length) {
    return productImages
  }

  const imageIds = new Set(variantImages.map((i) => i.id))
  return productImages.filter((i) => imageIds.has(i.id))
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const { handle } = params
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const product = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  const description = metaDescription(product)

  return {
    title: product.title,
    description,
    // Canonical, and it is load-bearing rather than hygiene. Note productUrl(): the default
    // region is served at the BARE path, so this must not carry a `/us` prefix — that URL
    // 307-redirects, and a canonical pointing at a redirect is worse than none at all.
    //
    // The size dropdown rewrites the URL with `?v_id=<variant>` on every selection, so a
    // seven-size product generates seven crawlable URLs serving near-identical pages. Left
    // alone that splits this page's ranking across all of them during an SEO migration —
    // the single worst moment to be diluting a URL's authority. One canonical collapses
    // them back onto the product.
    alternates: {
      canonical: productUrl(getBaseURL(), params.countryCode, product.handle),
    },
    openGraph: {
      title: `${product.title} | ${STORE_NAME}`,
      description,
      images: product.thumbnail ? [product.thumbnail] : [],
    },
  }
}

export default async function ProductPage(props: Props) {
  const params = await props.params
  const region = await getRegion(params.countryCode)
  const searchParams = await props.searchParams

  const selectedVariantId = searchParams.v_id

  if (!region) {
    notFound()
  }

  const pricedProduct = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle: params.handle },
  }).then(({ response }) => response.products[0])

  // Order matters: check the product exists BEFORE touching it.
  //
  // getImagesForVariant() ran first and dereferenced an undefined product, so a handle that
  // no longer resolves returned **500 instead of 404**. Handles do change — the catalogue
  // import renames them as mappings get resolved, and I hit this on a product renamed out
  // from under me mid-session.
  //
  // The difference is not cosmetic during an SEO migration. A 404 tells a crawler the page
  // is gone and to drop it; a 500 says the site is broken and to come back later, and
  // repeated 5xx is how a domain loses ranking across pages that were fine. With 1,299
  // redirects pointing into this route, the wrong status code is expensive.
  if (!pricedProduct) {
    notFound()
  }

  const images = getImagesForVariant(pricedProduct, selectedVariantId)

  // schema.org/Product. Built from the same price and availability helpers the page renders
  // from, so the markup cannot disagree with what a shopper sees. See product-schema.ts.
  const jsonLd = productJsonLd(
    pricedProduct,
    productUrl(getBaseURL(), params.countryCode, pricedProduct.handle),
    getBaseURL()
  )

  // Same crumbs the visible breadcrumb renders — one source, so they cannot disagree.
  const breadcrumbLd = breadcrumbJsonLd(
    productBreadcrumbs(pricedProduct),
    getBaseURL(),
    params.countryCode
  )

  return (
    <>
      {breadcrumbLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
        />
      )}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <ProductTemplate
        product={pricedProduct}
        region={region}
        countryCode={params.countryCode}
        images={images}
      />
    </>
  )
}
