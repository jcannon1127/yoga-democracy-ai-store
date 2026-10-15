"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import { getAvailability, isBackorder, isOrderable } from "@lib/util/availability"
import { sortProductOptions } from "@lib/util/sizes"
import {
  findVariant,
  OptionKeymap,
  optionsAsKeymap,
  optionValueStates,
  ValueState,
} from "@lib/util/variant-matrix"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@medusajs/ui"
import { SaleCallout, saleCalloutFor } from "@lib/util/sale-callout"
import { getProductPrice } from "@lib/util/get-product-price"
import { useParams, usePathname, useSearchParams, useRouter } from "next/navigation"
import React, { useEffect, useMemo, useRef, useState } from "react"

import ProductPrice from "../product-price"
import AvailabilityLine from "./availability-line"
import MobileActions from "./mobile-actions"
import OptionSelect from "./option-select"
import QuantitySelect from "./quantity-select"

type ProductActionsProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
  /**
   * Rendered between the dropdowns and the availability line, where the live page puts the
   * size-chart link. Passed in from the server so the chart itself never enters this
   * client bundle.
   */
  sizeChart?: React.ReactNode
  /** Backorder copy, read from content on the server. */
  backorderMessage?: string
  /** Warehouse-sale tiers, from content — see lib/content/site-chrome.ts. */
  saleCallouts?: SaleCallout[]
}

/**
 * The buy box, rebuilt against the live product page rather than the Medusa starter.
 *
 * Order on yogademocracy.com, top to bottom: size and length dropdowns with quantity beside
 * them, the size-chart link, an availability line, the price (struck-through original then
 * sale), and a full-width Add to Cart that stays disabled until the choice is complete.
 *
 * Deliberately NOT here:
 * - **Wishlist.** The live page has one. yd-features ruled it dropped for launch: guest
 *   lists on the live site expire with the session, durable lists live in the SFCC customer
 *   profile, and that data is not in the 8/17 export and cannot be pulled without Business
 *   Manager. The honest choice is no wishlist, not a wishlist that silently starts empty.
 * - **The promotions callout** ("$10 Tops"). Deferred by yd-features. The badge only
 *   explains a price the customer can already see, and it needs promotions data in Medusa.
 *
 *   **This comment used to say "the price is the truth and is already right". That is 552
 *   of 555, not all of them** — yd-promo measured 3 products charging $68 for a legging the
 *   live site sells at $20. Two are the length split (the same garment as two Medusa
 *   products, 1101 and 1103, where only one twin is in the sale price list), and the third
 *   is discounted live while sitting outside the warehouse-sale category, so a
 *   category-derived price list never saw it. Prices, sale state and codes are yd-promo's
 *   surface; hand anything in that area over rather than patching it here.
 * - **Apple Pay express.** The live page carries it (`cart-and-ipay`). Payment is yd-pay's;
 *   the slot is left directly under Add to Cart.
 */
export default function ProductActions({
  product,
  disabled,
  sizeChart,
  backorderMessage,
  saleCallouts = [],
}: ProductActionsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [options, setOptions] = useState<OptionKeymap>({})
  const [quantity, setQuantity] = useState(1)
  const [isAdding, setIsAdding] = useState(false)
  const countryCode = useParams().countryCode as string

  // Size before Length, always. 29 products carry both and the import produced them in
  // both orders, so the API's order is not a presentation order.
  const orderedOptions = useMemo(
    () => sortProductOptions(product.options ?? []),
    [product.options]
  )

  // If there is only 1 variant, preselect the options
  useEffect(() => {
    if (product.variants?.length === 1) {
      setOptions(optionsAsKeymap(product.variants[0].options))
    }
  }, [product.variants])

  // Preselect from ?v_id=. The starter writes this param on every selection but never reads
  // it back, so a link to a specific size arrives with nothing selected — which then reads
  // as "Out of stock". Deep links to a variant are the whole point of the param.
  useEffect(() => {
    const vId = searchParams.get("v_id")
    if (!vId || Object.keys(options).length > 0) {
      return
    }
    const fromUrl = product.variants?.find((v) => v.id === vId)
    if (fromUrl) {
      setOptions(optionsAsKeymap(fromUrl.options))
    }
  }, [searchParams, product.variants])

  const selectedVariant = useMemo(
    () => findVariant(product, options, orderedOptions.length),
    [product, options, orderedOptions.length]
  )

  const isValidVariant = !!selectedVariant

  /**
   * Which values each dropdown may offer, given the other dropdown. Recomputed on every
   * selection because the constraint runs both ways: choosing Extra Long greys out the
   * sizes it is not cut in, and choosing 3XL greys out Extra Long if that pair was never
   * made. The matrix is deliberately incomplete — that is a cut decision, not a bug.
   */
  const optionStates = useMemo(() => {
    const out: Record<string, ValueState[]> = {}
    for (const option of orderedOptions) {
      out[option.id] = optionValueStates(
        product,
        option.id,
        (option.values ?? []).map((v) => v.value),
        options
      )
    }
    return out
  }, [product, orderedOptions, options])

  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => {
      // Re-selecting the placeholder clears the choice. Delete the key rather than storing
      // undefined — the value states treat "absent" as unconstrained, and an undefined
      // entry would read as a constraint nothing can satisfy.
      const next = { ...prev }
      if (value) {
        next[optionId] = value
      } else {
        delete next[optionId]
      }
      return next
    })
  }

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const value = selectedVariant?.id ?? null

    if (params.get("v_id") === value) {
      return
    }

    if (value) {
      params.set("v_id", value)
    } else {
      params.delete("v_id")
    }

    router.replace(pathname + "?" + params.toString())
  }, [selectedVariant])

  // Stock and orderability are deliberately separate — see src/lib/util/availability.ts.
  // `null` quantity means unmanaged, which is "we don't know", not "we have none".
  const availability = useMemo(
    () => getAvailability(selectedVariant),
    [selectedVariant]
  )
  // Orderability is a separate question from stock — a confirmed zero that YD backorders
  // is still buyable, and must not disable the button.
  const canOrder = isOrderable(selectedVariant)

  // Every variant unbuyable: there is nothing for the customer to select, so the availability
  // line must not tell them to select something. 12 of 543 products are in this state.
  const nothingSellable = useMemo(
    () => (product.variants ?? []).length > 0 &&
          !(product.variants ?? []).some((v) => isOrderable(v)),
    [product.variants]
  )
  const backordered = isBackorder(selectedVariant)

  const actionsRef = useRef<HTMLDivElement>(null)
  const inView = useIntersection(actionsRef, "0px")

  const handleAddToCart = async () => {
    if (!selectedVariant?.id) return null

    setIsAdding(true)

    await addToCart({
      variantId: selectedVariant.id,
      quantity,
      countryCode,
    })

    setIsAdding(false)
  }

  /**
   * Show the option controls whenever the product HAS options — not only when there is
   * more than one variant.
   *
   * The starter hid them on single-variant products, on the reasoning that there is nothing
   * to choose. For apparel that is wrong: 9 products are cut in exactly one size, and on
   * those the page never told the customer which size it was. Someone buys an Ultimate
   * Trouser and finds out it is a Small when it arrives — which for clothing is a
   * guaranteed return, and YD processes returns by hand.
   *
   * Nothing to choose is not the same as nothing to say. The dropdown renders with its one
   * value already selected, so it reads as information rather than a decision.
   */
  const hasOptions = orderedOptions.some((option) => (option.values?.length ?? 0) > 0)

  // The callout follows the price the customer is being shown, so it tracks a variant once
  // one is chosen and the cheapest price before that — the same source ProductPrice uses,
  // so the line and the number beneath it can never disagree.
  const { cheapestPrice, variantPrice } = getProductPrice({
    product,
    variantId: selectedVariant?.id,
  })
  const shownPrice = selectedVariant ? variantPrice : cheapestPrice
  const calloutLabel = saleCalloutFor(
    shownPrice?.calculated_price_number,
    saleCallouts
  )

  return (
    <div className="flex flex-col gap-y-4" ref={actionsRef}>
      {hasOptions && (
        <div className="grid grid-cols-3 gap-x-4 gap-y-4 items-end">
          {orderedOptions.map((option) => (
            <div key={option.id} className="col-span-2">
              <OptionSelect
                option={option}
                current={options[option.id]}
                updateOption={setOptionValue}
                title={option.title ?? ""}
                states={optionStates[option.id] ?? []}
                data-testid="product-options"
                disabled={!!disabled || isAdding}
              />
            </div>
          ))}
          {/* Quantity sits in the last column beside the final dropdown, as on the live page. */}
          <div className="col-span-1">
            <QuantitySelect
              value={quantity}
              onChange={setQuantity}
              disabled={!!disabled || isAdding}
            />
          </div>
        </div>
      )}

      {sizeChart}

      <AvailabilityLine
        availability={availability}
        backordered={backordered}
        backorderMessage={backorderMessage}
        hasSelection={isValidVariant}
        nothingSellable={nothingSellable}
      />

      {calloutLabel && (
        // The live page's promotions callout, above the price exactly as it sits there.
        // Rendered as a static line, not the <button> live uses: that button carries no href
        // and no data-target and does nothing when clicked, and shipping a control that
        // looks pressable and is not is worse than shipping the text.
        // Measured on live: 16px, rgb(223,86,65), full width, left-aligned, 53px tall.
        <div
          className="w-full min-h-[53px] flex items-center text-left text-[16px] text-[rgb(223,86,65)]"
          data-testid="sale-callout"
        >
          {calloutLabel}
        </div>
      )}

      <ProductPrice product={product} variant={selectedVariant} />

      <Button
        onClick={handleAddToCart}
        disabled={!canOrder || !selectedVariant || !!disabled || isAdding}
        variant="secondary"
        // The live site's disabled Add to Cart keeps its black border and dark text
        // (`.btn-secondary:disabled { border: .0625rem solid #000 }`) so it reads as "not
        // yet" rather than "broken". Medusa's default disabled styling fades both almost to
        // white, which on a phone looks like a failed page.
        // Live measures 16px/400 in a 53px-tall button; Medusa's `secondary` gave 13px/500 in
        // 48px, which reads as a smaller, tighter button beside the same page. Sizes are set
        // here rather than in globals.css because they are this button, not site chrome —
        // the site-wide button scale is yd-store's.
        className="yd-atc w-full h-[53px] text-[16px] leading-[21.35px] font-normal rounded-base border border-ui-fg-base bg-white text-ui-fg-base hover:bg-ui-bg-subtle-hover disabled:opacity-100 disabled:border-ui-fg-base disabled:text-ui-fg-muted disabled:bg-ui-bg-subtle"
        isLoading={isAdding}
        data-testid="add-product-button"
      >
        Add to Cart
      </Button>

      {/* Seam: Apple Pay express sits here on the live page (`cart-and-ipay`). yd-pay owns it. */}

      <MobileActions
        product={product}
        variant={selectedVariant}
        options={options}
        updateOptions={setOptionValue}
        optionStates={optionStates}
        orderedOptions={orderedOptions}
        inStock={canOrder}
        handleAddToCart={handleAddToCart}
        isAdding={isAdding}
        show={!inView}
        optionsDisabled={!!disabled || isAdding}
      />
    </div>
  )
}
