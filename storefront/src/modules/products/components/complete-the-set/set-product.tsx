"use client"

import { useState } from "react"
import { Button, clx } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import { useParams } from "next/navigation"

import { addToCart } from "@lib/data/cart"
import { isUnavailable } from "@lib/util/availability"
import { optionValueLabel, sortOptionValues } from "@lib/util/sizes"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * One row of the "Complete the Set" rail: image, name, size, Add to Cart.
 *
 * Single-option products get an inline size picker and buy straight from this page, as on
 * the live site. **Two-option products do not** — they link through to their own page
 * instead. That is a deliberate departure: the live rail renders one dropdown regardless,
 * and for a legging that means adding a garment without ever choosing an inseam. Shipping
 * somebody a 28" when they wanted 32" is a return, a refund, and a hand-processed exchange
 * (YD has no returns portal), which is a poor trade for saving one click.
 */
const SetProduct = ({ product }: { product: HttpTypes.StoreProduct }) => {
  const countryCode = useParams().countryCode as string
  const [value, setValue] = useState("")
  const [isAdding, setIsAdding] = useState(false)

  const options = product.options ?? []
  const singleOption = options.length === 1 ? options[0] : undefined

  const variantFor = (optionValue: string) =>
    product.variants?.find((v) =>
      (v.options ?? []).some(
        (o: any) => o.option_id === singleOption?.id && o.value === optionValue
      )
    )

  const selected = value ? variantFor(value) : undefined
  const soldOut = selected ? isUnavailable(selected) : false

  const handleAdd = async () => {
    if (!selected?.id) return
    setIsAdding(true)
    await addToCart({ variantId: selected.id, quantity: 1, countryCode })
    setIsAdding(false)
  }

  return (
    <div className="flex gap-x-4 py-4 border-b border-ui-border-base last:border-b-0">
      <LocalizedClientLink
        href={`/products/${product.handle}`}
        className="shrink-0 w-20 relative aspect-[29/34] bg-ui-bg-subtle overflow-hidden"
      >
        {product.thumbnail && (
          <Image
            src={product.thumbnail}
            alt={product.title}
            fill
            sizes="80px"
            className="object-cover"
          />
        )}
      </LocalizedClientLink>

      <div className="flex flex-col gap-y-2 flex-1 min-w-0">
        <LocalizedClientLink
          href={`/products/${product.handle}`}
          className="txt-compact-medium text-ui-fg-base hover:text-ui-fg-subtle"
          data-testid="set-product-name"
        >
          {product.title}
        </LocalizedClientLink>

        {singleOption ? (
          <>
            <select
              value={value}
              aria-label={`Select ${singleOption.title} for ${product.title}`}
              onChange={(e) => setValue(e.target.value)}
              className="yd-select yd-select--compact"
            >
              <option value="">Select {singleOption.title}</option>
              {sortOptionValues(
                singleOption.title ?? "",
                (singleOption.values ?? []).map((v) => v.value)
              ).map((optionValue) => {
                const variant = variantFor(optionValue)
                return (
                  <option
                    key={optionValue}
                    value={optionValue}
                    disabled={!variant || isUnavailable(variant)}
                  >
                    {optionValueLabel(singleOption.title ?? "", optionValue)}
                  </option>
                )
              })}
            </select>

            {/* The live rail hides this button outright when it cannot be used, rather than
                showing a dead grey control. Same here. */}
            {selected && !soldOut && (
              <Button
                onClick={handleAdd}
                isLoading={isAdding}
                variant="secondary"
                className="w-full h-9 rounded-large border border-ui-fg-base bg-white text-ui-fg-base"
                data-testid="set-add-to-cart"
              >
                Add to Cart
              </Button>
            )}
          </>
        ) : (
          <LocalizedClientLink
            href={`/products/${product.handle}`}
            className="txt-small underline text-ui-fg-subtle hover:text-ui-fg-base"
          >
            Choose size and length
          </LocalizedClientLink>
        )}
      </div>
    </div>
  )
}

export default SetProduct
