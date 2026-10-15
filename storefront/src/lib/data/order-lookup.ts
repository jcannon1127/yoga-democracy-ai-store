"use server"

import { sdk } from "@lib/config"

/**
 * Guest order tracking — order number + email + postal code, no account.
 *
 * Parity with the live SFCC `Order-Track` page, which asks for the same three fields and
 * answers every failure with one combined message. Backed by a custom Medusa route
 * (`POST /store/orders/lookup`) because Medusa v2 has no guest path at all: `GET /store/orders`
 * is hard-scoped to the authenticated customer.
 */

export type GuestOrder = {
  order_number: string | null
  status: string
  placed_at: string
  currency_code: string
  totals: {
    subtotal: number
    shipping: number
    tax: number
    discount: number
    total: number
  }
  items: {
    title: string
    variant_title: string | null
    sku: string | null
    quantity: number
    thumbnail: string | null
    unit_price: number
  }[]
  ship_to: {
    name: string | null
    city: string | null
    province: string | null
    postal_code: string | null
    country_code: string | null
  } | null
  shipments: {
    shipped_at: string | null
    delivered_at: string | null
    tracking: { number: string | null; url: string | null }[]
  }[]
  // Set only on orders that came from SFCC. They have no joinable shipment records, so an
  // empty `shipments` on a legacy order means "unknown", not "nothing shipped".
  is_legacy?: boolean
}

export type LookupResult =
  | { state: "found"; order: GuestOrder }
  | { state: "not_found"; message: string }
  | { state: "invalid"; message: string }
  // `unavailable` is NOT folded into `not_found`. If the lookup service is down, telling the
  // customer "we could not find your order" sends them to CS to argue about an order that
  // exists. A broken backend and a wrong order number are different facts and the customer
  // is told which one they are looking at.
  | { state: "unavailable"; message: string }

export async function lookupGuestOrder(
  _currentState: unknown,
  formData: FormData
): Promise<LookupResult> {
  const order_number = ((formData.get("order_number") as string) || "").trim()
  const email = ((formData.get("email") as string) || "").trim()
  const postal_code = ((formData.get("postal_code") as string) || "").trim()

  if (!order_number || !email || !postal_code) {
    return {
      state: "invalid",
      message:
        "Please enter your order number, the email address you ordered with, and the postal code on the order.",
    }
  }

  try {
    const res = await sdk.client.fetch<{ order: GuestOrder }>(
      "/store/orders/lookup",
      { method: "POST", body: { order_number, email, postal_code } }
    )
    return { state: "found", order: res.order }
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status

    if (status === 404) {
      // Verbatim from the live site's Order-Track. Parity, not a phrasing choice — see the
      // route. One message for every failure mode; never says which field was wrong.
      return {
        state: "not_found",
        message:
          "Sorry this order number, email or postal code does not match our records. Check your records and try again.",
      }
    }

    if (status === 429) {
      return {
        state: "unavailable",
        message:
          "That is a lot of lookups in a short time. Please wait a minute and try again.",
      }
    }

    // Anything else — a 500, a 503, a network fault — is ours, not the customer's.
    return {
      state: "unavailable",
      message:
        "Order lookup is temporarily unavailable. Please try again shortly, or contact us and we will look it up for you.",
    }
  }
}
