"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders, getCacheOptions } from "./cookies"

/**
 * The signed-in customer's SFCC order history.
 *
 * YD has 120,783 historical orders and, today, zero native Medusa ones — so for a long while
 * after launch this IS the order history. A returning customer who signs in and sees "Nothing
 * to see here" against eleven years of purchases is the exact failure this lane was warned
 * about: the account works, the login works, and the history is empty with nothing erroring.
 */

export type LegacyOrder = {
  id: string
  order_number: string
  placed_at: string | null
  status: string | null
  currency_code: string
  total: number | null
  subtotal: number | null
  shipping_total: number | null
  tax_total: number | null
  discount_total: number | null
  ship_to: Record<string, any> | null
  items: {
    title: string | null
    sku: string | null
    quantity: number | null
    unit_price: number | null
    total_price: number | null
    status: string | null
  }[]
  is_legacy: true
}

/**
 * Returns `null` — NOT an empty list — when the history could not be read.
 *
 * The two are rendered completely differently and must never be collapsed. An empty list means
 * "you have no previous orders"; `null` means "we could not load them". Telling a customer with
 * forty orders that they have none, because a query failed, sends them to customer service
 * convinced their account is broken. This is the same `absent`-versus-`unreadable` distinction
 * yd-email uses on the email checks.
 */
export const listLegacyOrders = async (
  limit = 50,
  offset = 0
): Promise<{ orders: LegacyOrder[]; count: number } | null> => {
  const headers = { ...(await getAuthHeaders()) }
  if (!("authorization" in headers)) {
    return null
  }
  const next = { ...(await getCacheOptions("legacy-orders")) }

  try {
    return await sdk.client.fetch<{ orders: LegacyOrder[]; count: number }>(
      "/store/customers/me/legacy-orders",
      { query: { limit, offset }, headers, next, cache: "no-store" }
    )
  } catch {
    return null
  }
}
