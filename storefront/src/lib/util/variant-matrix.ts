import { HttpTypes } from "@medusajs/types"
import { isUnavailable } from "./availability"

/**
 * Which sizes and lengths a customer may pick, and why.
 *
 * The live product page renders every value in the run and *disables* the ones you cannot
 * have — it never hides them. That is deliberate: seeing "3XL, greyed out" tells you the
 * size exists and is gone; a dropdown that silently omits it tells you YD does not make it.
 * We match that.
 *
 * A value is unselectable for exactly two reasons:
 *
 * 1. **No such variant.** A legging's size x length matrix is deliberately incomplete — Extra
 *    Long is cut in fewer sizes than Standard. Combinations that were never made simply are
 *    not there, and that is not a stock fact.
 * 2. **Every variant behind it is a confirmed zero that cannot be backordered either.**
 *    A zero YD is willing to backorder stays selectable — the page says so on the
 *    availability line rather than closing the sale.
 *
 * `unknown` is never a reason. About a third of variants have no inventory record at all
 * (the SKU was absent from the fulfillment feed), and "we have no figure" is not "we have
 * none". Disabling those would tell customers YD is sold out of stock it may well be
 * holding. They stay selectable.
 */

export type OptionKeymap = Record<string, string>

/** A variant's options as `{ [option_id]: value }`. */
export const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"]
): OptionKeymap =>
  (variantOptions ?? []).reduce((acc: OptionKeymap, varopt: any) => {
    if (varopt?.option_id) {
      acc[varopt.option_id] = varopt.value
    }
    return acc
  }, {})

const matches = (variant: HttpTypes.StoreProductVariant, wanted: OptionKeymap) => {
  const have = optionsAsKeymap(variant.options)
  return Object.entries(wanted).every(([optionId, value]) => have[optionId] === value)
}

/** The variant that satisfies every currently-chosen option, if the choice is complete. */
export const findVariant = (
  product: HttpTypes.StoreProduct,
  selection: OptionKeymap,
  optionCount: number
) => {
  if (Object.keys(selection).length < optionCount) return undefined
  return (product.variants ?? []).find((v) => matches(v, selection))
}

export type ValueState = {
  value: string
  /** Cannot be chosen: either the combination does not exist, or it is a confirmed zero. */
  disabled: boolean
  /** True only when the combination exists and every variant behind it is a confirmed zero. */
  soldOut: boolean
}

/**
 * State for each value of one option, given what else is already selected.
 *
 * Other options' current values constrain this one — picking Extra Long should grey out the
 * sizes Extra Long is not cut in. Selections for *this* option are ignored, otherwise
 * choosing a size would rule out every other size.
 */
export const optionValueStates = (
  product: HttpTypes.StoreProduct,
  optionId: string,
  values: string[],
  selection: OptionKeymap
): ValueState[] => {
  const constraints: OptionKeymap = Object.fromEntries(
    Object.entries(selection).filter(([id, v]) => id !== optionId && !!v)
  )

  return values.map((value) => {
    const candidates = (product.variants ?? []).filter((v) =>
      matches(v, { ...constraints, [optionId]: value })
    )

    if (!candidates.length) {
      return { value, disabled: true, soldOut: false }
    }

    // Selectable if ANY candidate can actually be bought. A confirmed zero that is
    // backorderable is still buyable, and YD sells that way at scale — 1,314 orders are On
    // Order right now — so it must not be greyed out.
    const soldOut = candidates.every((v) => isUnavailable(v))
    return { value, disabled: soldOut, soldOut }
  })
}
