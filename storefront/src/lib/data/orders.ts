"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { getAuthHeaders, getCacheOptions } from "./cookies"
import { HttpTypes } from "@medusajs/types"

export const retrieveOrder = async (id: string) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("orders")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreOrderResponse>(`/store/orders/${id}`, {
      method: "GET",
      query: {
        // `+customer_id`, AND THE PLUS IS THE WHOLE THING.
        //
        // Medusa omits `customer_id` from the default projection, so the ownership check in the
        // account order-detail page had nothing to compare against until it was asked for. But
        // a BARE `customer_id` turns the list into an explicit allowlist and destroys every
        // default base field -- measured: `display_id` came back null, `email` and
        // `shipping_address` absent, so the owner's own order rendered blank while the guard
        // happily let them through. `+` ADDS to the defaults instead of replacing them.
        //
        // Same trap as `fields: "*orders"` on retrieveCustomer (2026-08-24): the projection
        // string silently decides what exists, and nothing errors when it takes something away.
        fields:
          "+customer_id,*payment_collections.payments,*items,*items.metadata,*items.variant,*items.variant.options,*items.variant.options.option,*items.product",
      },
      headers,
      next,
      cache: "force-cache",
    })
    .then(({ order }) => order)
    .catch((err) => medusaError(err))
}

export const listOrders = async (
  limit: number = 10,
  offset: number = 0,
  filters?: Record<string, any>
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("orders")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreOrderListResponse>(`/store/orders`, {
      method: "GET",
      query: {
        limit,
        offset,
        order: "-created_at",
        fields: "*items,+items.metadata,*items.variant,*items.variant.options,*items.variant.options.option,*items.product",
        ...filters,
      },
      headers,
      next,
      cache: "force-cache",
    })
    // `count` KEPT, not discarded. The starter returned only `orders`, so every caller was
    // structurally unable to know whether more existed -- and the default limit is 10. Proven
    // on 2026-08-26 against a real customer with 12 orders: ten rendered, two silently absent,
    // no pager, nothing wrong on the page. Same defect the legacy list had, one component over.
    .then(({ orders, count }) => ({ orders, count: count ?? orders.length }))
    .catch((err) => medusaError(err))
}

export const createTransferRequest = async (
  state: {
    success: boolean
    error: string | null
    order: HttpTypes.StoreOrder | null
  },
  formData: FormData
): Promise<{
  success: boolean
  error: string | null
  order: HttpTypes.StoreOrder | null
}> => {
  const id = formData.get("order_id") as string

  if (!id) {
    return { success: false, error: "Order ID is required", order: null }
  }

  const headers = await getAuthHeaders()

  return await sdk.store.order
    .requestTransfer(
      id,
      {},
      {
        fields: "id, email",
      },
      headers
    )
    .then(({ order }) => ({ success: true, error: null, order }))
    .catch((err) => ({ success: false, error: err.message, order: null }))
}

export const acceptTransferRequest = async (id: string, token: string) => {
  const headers = await getAuthHeaders()

  return await sdk.store.order
    .acceptTransfer(id, { token }, {}, headers)
    .then(({ order }) => ({ success: true, error: null, order }))
    .catch((err) => ({ success: false, error: err.message, order: null }))
}

export const declineTransferRequest = async (id: string, token: string) => {
  const headers = await getAuthHeaders()

  return await sdk.store.order
    .declineTransfer(id, { token }, {}, headers)
    .then(({ order }) => ({ success: true, error: null, order }))
    .catch((err) => ({ success: false, error: err.message, order: null }))
}
