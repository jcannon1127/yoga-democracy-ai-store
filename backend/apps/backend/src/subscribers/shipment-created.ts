import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { dispatch } from '../modules/email/providers/dispatch'
import { nodeIo } from '../modules/email/providers/node-io'
import { mapFulfillmentToShipmentNotice } from '../modules/email/medusa-map'
import { decideNotify } from '../modules/email/events'
import { shipmentOwner } from '../modules/email/shipment-owner'

/**
 * Shipment notice.
 *
 * **The event is `shipment.created`, and getting this one wrong is the most expensive mistake
 * available in this lane — because the wrong answer is not inert.**
 *
 * The obvious guess is `order.fulfillment_created`. It exists, it fires, and a subscriber on
 * it runs happily. But it fires when the warehouse creates the fulfillment — items picked, no
 * label bought, no tracking number in existence. `renderShipmentNotice` correctly returns null
 * without a tracking number, so every single order would be recorded as
 * `skip: no tracking number` — a permanent, clean-looking, perfectly-reasoned refusal on every
 * order YD ships, agreed with by the reconciliation, and nobody would ever get a tracking
 * email. `shipment.created` is emitted by `createShipmentWorkflow`, which is what attaches
 * `labels[]` and stamps `shipped_at`. Verified in the installed 2.19.0 at
 * `core-flows/dist/order/workflows/create-shipment.js:154`.
 *
 * **`data.id` is a FULFILLMENT id. There is no order id in the payload at all.** Anything
 * reading `data.order_id` gets `undefined` and goes looking for an order called "undefined".
 * The order has to be found from the fulfillment, which is the one step in this file not yet
 * exercised against a running Medusa — see the note on the lookup below.
 *
 * **THIS FIRES AT LABEL CREATION, AND THE VOID GUARD THEREFORE BARELY BITES — stated here
 * because the guard's own file used to imply otherwise.** `shipment.created` is emitted when
 * the label is created, so `fulfillment.canceled_at` is almost always null at this moment.
 * Measured across 25 real voids: median 17 minutes to void, only four at zero. **Preventing the
 * rest needs a deferred send, whose cost is delaying every customer's tracking email — a
 * business trade-off for the owner or tech lead, with the numbers in `shouldSend()`.**
 *
 * **`no_notification` is honoured, and read carefully.** See `decideNotify`: a truthiness test
 * on this field suppresses on the string `"false"`, which is a shape an event crossing a bus
 * can genuinely arrive in.
 */
const MARKER = '[shipment-notice]'

const FIELDS = [
  'id', 'display_id', 'email',
  'items.id', 'items.title', 'items.quantity',
  'shipping_address.*', 'billing_address.*', 'customer.first_name', 'customer.last_name',
  'fulfillments.id', 'fulfillments.canceled_at', 'fulfillments.shipped_at',
  'fulfillments.labels.tracking_number', 'fulfillments.labels.tracking_url',
  'fulfillments.items.title', 'fulfillments.items.quantity', 'fulfillments.items.line_item_id',
]

export default async function shipmentCreatedHandler({
  event, container,
}: SubscriberArgs<{ id: string; no_notification?: unknown }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fulfillmentId = event.data?.id

  if (!fulfillmentId) {
    logger.error(`${MARKER} shipment.created arrived with no fulfillment id.`)
    return
  }

  // **Before anything else: does this system own the shipment email at all?** ShipStation is
  // sending YD's shipment notices today, and sending ours as well gives every customer two
  // emails per parcel with nothing erroring on either side. See shipment-owner.ts.
  const owner = shipmentOwner(process.env as Record<string, string | undefined>)
  if (owner.state !== 'ours') {
    const level = owner.state === 'undeclared' ? 'error' : 'info'
    logger[level](`${MARKER} not sending for fulfillment ${fulfillmentId}: ${owner.detail}`)
    return
  }

  const notify = decideNotify(event.data)
  if (notify.state === 'unclear') logger.error(`${MARKER} ${notify.detail}`)
  if (!notify.notify) {
    // A human deliberately suppressed this one. Not a failure, and recorded at info so the
    // absence of an email has an explanation next to it in the log.
    logger.info(`${MARKER} fulfillment ${fulfillmentId}: ${notify.detail}`)
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  let order: Record<string, unknown> | undefined
  try {
    // **The one unverified step in this lane.** Filtering orders by a linked fulfillment id is
    // the documented shape, but it has not been run against a live Medusa here — YD has no
    // shipped Medusa order yet. It is written so that being wrong is LOUD rather than silent:
    // a throw or an empty result both land in the error branches below, naming the fulfillment
    // that shipped without an email. It cannot fail quietly.
    // the operations agent 2026-08-25: TYPE-ONLY cast, runtime shape unchanged. Medusa's generated
    // filter type for `order` does not include `fulfillments`, so tsc rejects this with TS2322
    // and `medusa build` fails — which left the backend with no build output and the store DOWN.
    // The logic above is deliberately written so a wrong filter shape is LOUD, not silent, so a
    // cast does not hide anything the error branches below would have caught. If the filter is
    // in fact unsupported at runtime, the catch and the !order branch still name the fulfillment.
    const { data } = await query.graph({ entity: 'order', fields: FIELDS,
      filters: { fulfillments: { id: fulfillmentId } } as any })
    order = data?.[0]
  } catch (e: any) {
    logger.error(`${MARKER} could not find the order for fulfillment ${fulfillmentId}: ` +
      `${e?.message ?? String(e)} — A PARCEL SHIPPED AND THE CUSTOMER WAS NOT TOLD.`)
    return
  }

  if (!order) {
    logger.error(`${MARKER} no order found for fulfillment ${fulfillmentId}. ` +
      `A PARCEL SHIPPED AND THE CUSTOMER WAS NOT TOLD.`)
    return
  }

  const all = Array.isArray(order.fulfillments)
    ? (order.fulfillments as Record<string, unknown>[]) : []
  const fulfillment = all.find((f) => f?.id === fulfillmentId)
  if (!fulfillment) {
    logger.error(`${MARKER} order ${order.id} does not list fulfillment ${fulfillmentId}. No notice sent.`)
    return
  }

  const to = typeof order.email === 'string' ? order.email : ''
  const storefrontUrl = (process.env.STOREFRONT_URL || '').replace(/\/+$/, '')
  const statusUrl = storefrontUrl ? `${storefrontUrl}/account/orders/${order.id}` : undefined

  // Passing every fulfillment is what lets the notice say what is still to come. Without it
  // the template says nothing, which is correct but less useful; with a WRONG list it would
  // tell a waiting customer their order was complete.
  const mapped = mapFulfillmentToShipmentNotice(fulfillment, order,
    { statusUrl, allFulfillments: all })
  if (!mapped.ok) {
    logger.error(`${MARKER} fulfillment ${fulfillmentId} could not be turned into a notice: ` +
      `${mapped.reason}. NO EMAIL SENT.`)
    return
  }
  for (const note of mapped.notes) logger.info(`${MARKER} fulfillment ${fulfillmentId}: ${note}`)

  await dispatch({
    template: 'shipment-notice',
    data: mapped.value as unknown as Record<string, unknown>,
    to,
    env: process.env as Record<string, string | undefined>,
    io: nodeIo((level, message) => logger[level](message)),
    order_id: typeof order.id === 'string' ? order.id : undefined,
    // **One order can ship in several parcels, and reconciling per order would pass with one
    // notice while two parcels went untold.** The fulfillment is the subject, not the order.
    subject_id: fulfillmentId,
  })
}

export const config: SubscriberConfig = {
  event: 'shipment.created',
}
