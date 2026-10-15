import { HttpTypes } from "@medusajs/types"

import { PRIMARY_CATEGORY_HANDLES } from "@lib/constants/store"

export type Crumb = { name: string; href: string }

/**
 * The product's breadcrumb trail, as ONE source.
 *
 * Both the visible breadcrumb and the BreadcrumbList structured data are built from this.
 * That is deliberate: markup that disagrees with the visible page is the category Google
 * issues manual actions for, and the only reliable way to keep two things in agreement is
 * to stop them being two things.
 *
 * A product sits in several categories at once -- Goddess Tank - Twig is in Tops, Solids and
 * Best Sellers -- so the merchandise category is chosen by preference order from config
 * rather than by taking whichever the API happened to list first.
 */
export const productBreadcrumbs = (
  product: HttpTypes.StoreProduct
): Crumb[] => {
  const categories = product.categories ?? []

  const primary =
    PRIMARY_CATEGORY_HANDLES.map((handle) =>
      categories.find((c) => c.handle?.toLowerCase() === handle)
    ).find(Boolean) ?? categories[0]

  const crumbs: Crumb[] = [
    { name: "Home", href: "/" },
    { name: "Shop", href: "/store" },
  ]

  if (primary?.handle && primary?.name) {
    crumbs.push({ name: primary.name, href: `/categories/${primary.handle}` })
  }

  return crumbs
}
