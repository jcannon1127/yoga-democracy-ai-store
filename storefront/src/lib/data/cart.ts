"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { guardCompletion, CartLine } from "@lib/util/completion-guard"
import { redirect } from "next/navigation"
import {
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeCartId,
  setCartId,
} from "./cookies"
import { getRegion } from "./regions"
import { regionPath } from "@lib/util/product-url"
import { getLocale } from "@lib/data/locale-actions"

/**
 * Retrieves a cart by its ID. If no ID is provided, it will use the cart ID from the cookies.
 * @param cartId - optional - The ID of the cart to retrieve.
 * @returns The cart object if found, or null if not found.
 */
/**
 * Attach each line's CATALOGUE original price, for the struck-through "was" in the cart.
 *
 * A price-list sale makes the sale price the line's own price, so `original_total` equals
 * `total` and nothing in the cart payload remembers the $54 the customer is saving against.
 * The obvious fix -- ask the cart for `*items.variant.calculated_price` -- **breaks the cart
 * outright**: on a cart holding a line item Medusa rejects the whole request with 400
 * "calculatePrices requires currency_code in the pricing context", so the cart reads as empty
 * and Add to Cart appears to do nothing.
 *
 * The catalogue already computes those prices with region context, and `getCatalogue` is
 * memoised for a minute and shared with browse and search -- so in the normal case this costs
 * no extra request at all. If it fails, the cart renders exactly as it did before: a missing
 * "was" price is a smaller harm than a cart that will not load.
 */
async function withCataloguePrices(
  cart: HttpTypes.StoreCart,
  countryCode?: string
): Promise<HttpTypes.StoreCart> {
  const region = countryCode || cart.region?.countries?.[0]?.iso_2
  if (!region || !cart.items?.length) return cart
  try {
    const { getCatalogue } = await import("./products")
    const catalogue = await getCatalogue(region)
    const originals = new Map<string, number>()
    for (const product of catalogue) {
      for (const variant of product.variants ?? []) {
        const price = (variant as any).calculated_price
        if (variant.id && typeof price?.original_amount === "number") {
          originals.set(variant.id, price.original_amount)
        }
      }
    }
    for (const item of cart.items) {
      const original = item.variant_id ? originals.get(item.variant_id) : undefined
      if (original !== undefined) {
        ;(item as any).catalogue_original_price = original
      }
    }
  } catch (error) {
    console.error("[cart] could not attach catalogue prices; cart renders without them", error)
  }
  return cart
}

export async function retrieveCart(cartId?: string, fields?: string) {
  const id = cartId || (await getCartId())
  // DO NOT add `*items.variant.calculated_price` here. I did, to show the struck original on
  // a catalogue sale, and it took ADD TO CART DOWN: on a cart that HAS a line item Medusa
  // answers the whole request with
  //   400 invalid_data — "Method calculatePrices requires currency_code in the pricing context"
  // so retrieveCart threw, every caller saw no cart, and the site's response to "Add to Cart"
  // was silence. It passed a probe against an EMPTY cart, because with no items there is
  // nothing to price -- the test has to carry a line item or it proves nothing.
  // The original price is joined in below instead, from the catalogue, where region context
  // exists. Same trap as the FIELDS_WITHOUT_STOCK fallback in products.ts: one greedy field
  // takes down prices, images and titles with it.
  fields ??=
    "*items, *region, *items.product, *items.variant, *items.variant.options, *items.variant.options.option, *items.thumbnail, *items.metadata, +items.total, *promotions, +shipping_methods.name"

  if (!id) {
    return null
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("carts")),
  }

  return await sdk.client
    .fetch<HttpTypes.StoreCartResponse>(`/store/carts/${id}`, {
      method: "GET",
      query: {
        fields,
      },
      headers,
      next,
      cache: "force-cache",
    })
    .then(({ cart }: { cart: HttpTypes.StoreCart }) => withCataloguePrices(cart))
    .catch(() => null)
}

export async function getOrSetCart(countryCode: string) {
  const region = await getRegion(countryCode)

  if (!region) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  let cart = await retrieveCart(undefined, "id,region_id")

  const headers = {
    ...(await getAuthHeaders()),
  }

  if (!cart) {
    const locale = await getLocale()
    const cartResp = await sdk.store.cart.create(
      { region_id: region.id, locale: locale || undefined },
      {},
      headers
    )
    cart = cartResp.cart

    await setCartId(cart.id)

    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  if (cart && cart?.region_id !== region.id) {
    await sdk.store.cart.update(cart.id, { region_id: region.id }, {}, headers)
    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  return cart
}

export async function updateCart(data: HttpTypes.StoreUpdateCart) {
  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("No existing cart found, please create one before updating")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .update(cartId, data, {}, headers)
    .then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)

      return cart
    })
    .catch(medusaError)
}

export async function addToCart({
  variantId,
  quantity,
  countryCode,
}: {
  variantId: string
  quantity: number
  countryCode: string
}) {
  if (!variantId) {
    throw new Error("Missing variant ID when adding to cart")
  }

  const cart = await getOrSetCart(countryCode)

  if (!cart) {
    throw new Error("Error retrieving or creating cart")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .createLineItem(
      cart.id,
      {
        variant_id: variantId,
        quantity,
      },
      {},
      headers
    )
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function updateLineItem({
  lineId,
  quantity,
}: {
  lineId: string
  quantity: number
}) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when updating line item")
  }

  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("Missing cart ID when updating line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .updateLineItem(cartId, lineId, { quantity }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function deleteLineItem(lineId: string) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when deleting line item")
  }

  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("Missing cart ID when deleting line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .deleteLineItem(cartId, lineId, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function setShippingMethod({
  cartId,
  shippingMethodId,
}: {
  cartId: string
  shippingMethodId: string
}) {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .addShippingMethod(cartId, { option_id: shippingMethodId }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
    })
    .catch(medusaError)
}

export async function initiatePaymentSession(
  cart: HttpTypes.StoreCart,
  data: HttpTypes.StoreInitializePaymentSession
) {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.payment
    .initiatePaymentSession(cart, data, {}, headers)
    .then(async (resp) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return resp
    })
    .catch(medusaError)
}

export async function applyPromotions(codes: string[]) {
  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("No existing cart found")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .update(cartId, { promo_codes: codes }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function applyGiftCard(code: string) {
  //   const cartId = getCartId()
  //   if (!cartId) return "No cartId cookie found"
  //   try {
  //     await updateCart(cartId, { gift_cards: [{ code }] }).then(() => {
  //       revalidateTag("cart")
  //     })
  //   } catch (error: any) {
  //     throw error
  //   }
}

export async function removeDiscount(code: string) {
  // const cartId = getCartId()
  // if (!cartId) return "No cartId cookie found"
  // try {
  //   await deleteDiscount(cartId, code)
  //   revalidateTag("cart")
  // } catch (error: any) {
  //   throw error
  // }
}

export async function removeGiftCard(
  codeToRemove: string,
  giftCards: any[]
  // giftCards: GiftCard[]
) {
  //   const cartId = getCartId()
  //   if (!cartId) return "No cartId cookie found"
  //   try {
  //     await updateCart(cartId, {
  //       gift_cards: [...giftCards]
  //         .filter((gc) => gc.code !== codeToRemove)
  //         .map((gc) => ({ code: gc.code })),
  //     }).then(() => {
  //       revalidateTag("cart")
  //     })
  //   } catch (error: any) {
  //     throw error
  //   }
}

export async function submitPromotionForm(
  currentState: unknown,
  formData: FormData
) {
  const code = formData.get("code") as string
  try {
    await applyPromotions([code])
  } catch (e: any) {
    return e.message
  }
}

// TODO: Pass a POJO instead of a form entity here
export async function setAddresses(currentState: unknown, formData: FormData) {
  try {
    if (!formData) {
      throw new Error("No form data found when setting addresses")
    }
    const cartId = getCartId()
    if (!cartId) {
      throw new Error("No existing cart found when setting addresses")
    }

    const data = {
      shipping_address: {
        first_name: formData.get("shipping_address.first_name"),
        last_name: formData.get("shipping_address.last_name"),
        address_1: formData.get("shipping_address.address_1"),
        address_2: "",
        company: formData.get("shipping_address.company"),
        postal_code: formData.get("shipping_address.postal_code"),
        city: formData.get("shipping_address.city"),
        country_code: formData.get("shipping_address.country_code"),
        province: formData.get("shipping_address.province"),
        phone: formData.get("shipping_address.phone"),
      },
      email: formData.get("email"),
    } as any

    const sameAsBilling = formData.get("same_as_billing")
    if (sameAsBilling === "on") data.billing_address = data.shipping_address

    if (sameAsBilling !== "on")
      data.billing_address = {
        first_name: formData.get("billing_address.first_name"),
        last_name: formData.get("billing_address.last_name"),
        address_1: formData.get("billing_address.address_1"),
        address_2: "",
        company: formData.get("billing_address.company"),
        postal_code: formData.get("billing_address.postal_code"),
        city: formData.get("billing_address.city"),
        country_code: formData.get("billing_address.country_code"),
        province: formData.get("billing_address.province"),
        phone: formData.get("billing_address.phone"),
      }
    await updateCart(data)
  } catch (e: any) {
    return e.message
  }

  redirect(
    `/${formData.get("shipping_address.country_code")}/checkout?step=delivery`
  )
}

/**
 * Places an order for a cart. If no cart ID is provided, it will use the cart ID from the cookies.
 * @param cartId - optional - The ID of the cart to place an order for.
 * @returns The cart object if the order was successful, or null if not.
 */
export async function placeOrder(cartId?: string) {
  const id = cartId || (await getCartId())

  if (!id) {
    throw new Error("No existing cart found when placing an order")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  /**
   * Last check before the cart is completed (yd-pay's guard).
   *
   * Runs on the Next server, not in the browser — so a customer cannot skip it by reloading.
   *
   * **BUT IT IS NOT UNAVOIDABLE, AND THIS COMMENT USED TO CLAIM IT WAS.** It guards THIS
   * storefront's path to completion. It does not guard the Store API, which is reachable by
   * anything that can read a webpage — the publishable key is in the page HTML. the catalogue agent
   * demonstrated it: 500 units of an unmanaged variant ordered straight through
   * POST /store/carts/:id/complete were accepted, $10,000 subtotal, no stock check and no
   * guard evaluation.
   *
   * What actually prevents overselling is Medusa's own server-side check, which is real and
   * works — it refuses qty 4 against 3 in stock — but only for variants that manage
   * inventory, and 1,103 currently do not. yd-alloc's sync flipping those to
   * manage_inventory=true is the fix; this guard is a second pair of eyes on the path
   * customers actually use, and a price-drift check Medusa does not do at all. It covers the case add-to-cart cannot — drift between adding and paying, while
   * a cart sits in a browser and a sale ends or stock goes. Add-to-cart never checks price
   * at all, and 1,103 variants manage no inventory and so refuse nothing.
   *
   * Three outcomes, split by WHAT went wrong rather than by confidence:
   *   REFUSE          positive evidence this cart is wrong -> stop, tell the customer
   *   ALLOW_AND_FLAG  we could not determine -> let it through, record loudly
   *   ALLOW           checked, nothing wrong
   *
   * The middle one matters: treating "our machinery failed" as evidence about a cart is how
   * a guard ends up declining every customer. A wrong price is recoverable after the fact;
   * a checkout that refuses everyone is immediate and total. Jeff can overrule that trade.
   */
  // Ask for the variant's CALCULATED PRICE explicitly. retrieveCart's default field list
  // does not include it, so without this every line's cataloguePrice is null, every line is
  // UNKNOWN, and the guard returns ALLOW_AND_FLAG for every order — wired, passing its
  // tests, and checking nothing. That failure is invisible from the outside: orders still
  // complete and the logs look busy.
  const cartForGuard = await retrieveCart(
    id,
    "*items, *items.variant, *items.variant.calculated_price, +items.unit_price"
  ).catch(() => null)
  const guardLines: CartLine[] = (cartForGuard?.items ?? []).map((item: any) => ({
    sku: item.variant?.sku ?? undefined,
    title: item.title ?? undefined,
    quantity: item.quantity ?? 0,
    unit_price: item.unit_price ?? 0,
    // What the customer would pay for this line right now. `calculated_amount` never
    // `original_amount`: with 57% of the catalogue on sale, comparing against the
    // struck-through price would report the entire sale as drift. A null price is UNKNOWN,
    // never a comparison against zero.
    cataloguePrice:
      item.variant?.calculated_price?.calculated_amount ?? null,
  }))

  // If NOTHING could be priced, say so loudly. A guard that flags every order is
  // indistinguishable from a guard that is working, unless it announces the difference.
  if (guardLines.length && guardLines.every((l) => l.cataloguePrice === null)) {
    console.error(
      "[checkout] completion guard could price NONE of the cart lines — it is not " +
        "checking anything. Verify the cart fields include items.variant.calculated_price."
    )
  }

  if (guardLines.length) {
    const guard = await guardCompletion(guardLines).catch((error) => {
      // The guard failing is our machinery failing, not evidence about this cart.
      console.error(
        "YD_GUARD_UNVERIFIED [checkout] completion guard threw; allowing and flagging",
        error
      )
      return {
        verdict: "ALLOW_AND_FLAG" as const,
        reason: "guard-threw",
        customerMessage: "",
        details: undefined,
      }
    })

    if (guard.verdict === "REFUSE") {
      console.error("YD_GUARD_REFUSED [checkout] REFUSED completion", {
        cartId: id,
        reason: guard.reason,
      })
      return { error: guard.customerMessage }
    }
    if (guard.verdict === "ALLOW_AND_FLAG") {
      console.warn("YD_GUARD_UNVERIFIED [checkout] completing WITHOUT a verified check", {
        cartId: id,
        reason: guard.reason,
      })
    }
  }

  const cartRes = await sdk.store.cart
    .complete(id, {}, headers)
    .then(async (cartRes) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return cartRes
    })
    .catch(medusaError)

  if (cartRes?.type === "order") {
    const countryCode =
      cartRes.order.shipping_address?.country_code?.toLowerCase()

    const orderCacheTag = await getCacheTag("orders")
    revalidateTag(orderCacheTag)

    removeCartId()
    redirect(
      regionPath(countryCode ?? "", `/order/${cartRes?.order.id}/confirmed`)
    )
  }

  return cartRes.cart
}

/**
 * Updates the countrycode param and revalidates the regions cache
 * @param regionId
 * @param countryCode
 */
export async function updateRegion(countryCode: string, currentPath: string) {
  const cartId = await getCartId()
  const region = await getRegion(countryCode)

  if (!region) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  if (cartId) {
    await updateCart({ region_id: region.id })
    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  const regionCacheTag = await getCacheTag("regions")
  revalidateTag(regionCacheTag)

  const productsCacheTag = await getCacheTag("products")
  revalidateTag(productsCacheTag)

  redirect(regionPath(countryCode, currentPath || "/"))
}

export async function listCartOptions() {
  const cartId = await getCartId()
  const headers = {
    ...(await getAuthHeaders()),
  }
  const next = {
    ...(await getCacheOptions("shippingOptions")),
  }

  return await sdk.client.fetch<{
    shipping_options: HttpTypes.StoreCartShippingOption[]
  }>("/store/shipping-options", {
    query: { cart_id: cartId },
    next,
    headers,
    cache: "force-cache",
  })
}
