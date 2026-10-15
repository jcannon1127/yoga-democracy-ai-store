import { Fragment } from "react"

import { HttpTypes } from "@medusajs/types"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { productBreadcrumbs } from "@lib/util/breadcrumbs"

/**
 * Home / Shop / Tops — the live product page's breadcrumb.
 *
 * Products belong to several categories at once (Tops *and* Solids *and* Best Sellers), so
 * the merchandise category is chosen by preference order from config rather than by taking
 * whichever the API listed first. Falls back to Home / Shop when a product has no category
 * we recognise, which is honest and still navigable.
 */
const ProductBreadcrumb = ({ product }: { product: HttpTypes.StoreProduct }) => {
  // One source, shared with the BreadcrumbList structured data on this page. See breadcrumbs.ts.
  const crumbs = productBreadcrumbs(product)

  return (
    // Hidden on phones only, matching the live page's `hidden-xs-down`.
    //
    // The threshold is an explicit 544px because that is the live site's own small
    // breakpoint — its CSS is a customised Bootstrap (544 / 769 / 992 / 1200 / 1440), not
    // the stock one. Tailwind's `sm` is 640 and this config's `small` is **1024**, so both
    // aliases were wrong in different directions: `small:` cost every tablet its breadcrumb,
    // and `sm:` still lost the 544-639 band where the live site shows one.
    //
    // Named breakpoints lie here — `small` meaning 1024px has now cost three lanes a bug —
    // so this states the number it means.
    <nav aria-label="Breadcrumb" className="hidden min-[544px]:block py-4">
      <ol className="flex items-center gap-x-2 txt-compact-small text-ui-fg-subtle">
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb.href}>
            {i > 0 && <li aria-hidden="true">/</li>}
            <li>
              <LocalizedClientLink
                href={crumb.href}
                className="hover:text-ui-fg-base"
                data-testid={
                  i === crumbs.length - 1 && i > 1
                    ? "breadcrumb-category"
                    : undefined
                }
              >
                {crumb.name}
              </LocalizedClientLink>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}

export default ProductBreadcrumb
