import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { dispatch } from '../modules/email/providers/dispatch'
import { nodeIo } from '../modules/email/providers/node-io'
import { mapOrderToConfirmation } from '../modules/email/medusa-map'

/**
 * Order confirmation.
 *
 * **The event name is `order.placed`, verified against the installed Medusa 2.19.0 rather
 * than remembered** — `OrderWorkflowEvents.PLACED`, emitted at CRITICAL priority from
 * `cart/workflows/complete-cart.js` and from `draft-order/workflows/convert-draft-order.js`.
 * `src/modules/email/check-events.ts` re-checks it against Medusa's own constants and exits
 * non-zero if it ever moves; run it after any Medusa upgrade. A subscriber on a wrong event
 * name does not error — it simply never runs — which is why the name gets a check of its own.
 *
 * **The payload is `{ id }` and nothing else.** No email address, no totals, no lines. Every
 * field the template needs is fetched here, and the fetch is the part that can silently
 * return less than it looks like it did: a field missing from the `fields` list below arrives
 * as `undefined`, and `undefined` money is exactly what `mapOrderToConfirmation` refuses on.
 *
 * **The draft-order path means an admin-typed order also emails the customer.** For YD that
 * is almost certainly right — a phone order should still confirm — but it is a behaviour
 * nobody chose, so it is written down here where whoever disagrees will find it.
 */
const MARKER = '[order-confirmation]'

const FIELDS = [
  'id', 'display_id', 'created_at', 'email', 'currency_code',
  'total', 'item_subtotal', 'shipping_total', 'tax_total', 'discount_total',
  'items.id', 'items.title', 'items.subtitle', 'items.variant_title', 'items.thumbnail',
  'items.quantity', 'items.unit_price',
  'shipping_address.*', 'billing_address.*', 'customer.first_name', 'customer.last_name',
]

export default async function orderPlacedHandler({
  event, container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id

  if (!orderId) {
    logger.error(`${MARKER} order.placed arrived with no id — no confirmation can be built.`)
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  let order: Record<string, unknown> | undefined
  try {
    const { data } = await query.graph({ entity: 'order', fields: FIELDS,
      filters: { id: orderId } })
    order = data?.[0]
  } catch (e: any) {
    // Loud, and deliberately not swallowed into "no order". A query that failed and an order
    // that does not exist are different problems with different fixes.
    logger.error(`${MARKER} could not load order ${orderId}: ${e?.message ?? String(e)} — ` +
      `the customer has paid and has NOT been confirmed.`)
    return
  }

  if (!order) {
    logger.error(`${MARKER} order ${orderId} was placed and cannot be read back. No confirmation sent.`)
    return
  }

  const to = typeof order.email === 'string' ? order.email : ''
  const storefrontUrl = (process.env.STOREFRONT_URL || '').replace(/\/+$/, '')
  const statusUrl = storefrontUrl ? `${storefrontUrl}/account/orders/${orderId}` : undefined

  const mapped = mapOrderToConfirmation(order, { statusUrl })
  if (!mapped.ok) {
    // A refusal here is the mapper protecting the customer from a wrong number on a receipt.
    // It is still a failure — somebody paid and got no email — so it is logged at error level.
    logger.error(`${MARKER} order ${orderId} could not be turned into a confirmation: ` +
      `${mapped.reason}. NO EMAIL SENT.`)
    return
  }
  for (const note of mapped.notes) logger.info(`${MARKER} order ${orderId}: ${note}`)

  await dispatch({
    template: 'order-confirmation',
    data: mapped.value as unknown as Record<string, unknown>,
    to,
    env: process.env as Record<string, string | undefined>,
    io: nodeIo((level, message) => logger[level](message)),
    order_id: orderId,
  })
}

export const config: SubscriberConfig = {
  event: 'order.placed',
}
