import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { readSendLog } from '../modules/email/providers/outbox.ts'
import { dispatch } from '../modules/email/providers/dispatch.ts'
import { nodeIo } from '../modules/email/providers/node-io.ts'
import { toMinorUnits } from '../modules/email/medusa-map.ts'
import { resolveOffer } from '../modules/email/abandoned-cart-offer.ts'
import { planJourney, buildCartData, summarisePlan, DEFAULT_WINDOWS,
  type CartCandidate } from '../modules/email/abandoned-cart-journey.ts'
import { existsSync, readFileSync } from 'node:fs'

/**
 * The abandoned-cart journey — the one part of this lane that is a TIMER, not an event.
 *
 * No Medusa event says "this cart has been quiet for a day", so there is nothing to subscribe
 * to. Note the one way that is easier than a subscriber: **`validateConfig` throws at boot if
 * `name` or `schedule` is missing**, so a mis-registered job is loud. Everything dangerous
 * here is in the selection, which is why the selection lives in
 * `modules/email/abandoned-cart-journey.ts` and is tested without a Medusa.
 *
 * **The handler signature is positional — `(container, context)` — NOT the destructured
 * `{ container }` a subscriber takes.** Writing it the subscriber's way gives an `undefined`
 * container and a crash on the first resolve, which is at least loud; the reason it is called
 * out is that the two files sit next to each other and look interchangeable.
 *
 * ── OFF BY DEFAULT, AND FOR A SPECIFIC REASON ────────────────────────────────────────────
 *
 * `ABANDONED_CART_ENABLED` must be `true`. Preview-only delivery already stops mail reaching
 * anyone unconfigured, so this is a second lock — deliberately, because of one scenario the
 * first lock does not cover. **YD is migrating a customer base off SFCC. If a migration stamps
 * `updated_at` at import time, every historical cart in the database looks freshly abandoned
 * at once** — and the window guard, which is what stops a lapsed job from firing a backlog,
 * cannot help, because those carts genuinely appear an hour old. The day someone wires a real
 * transport for order confirmations must not be the day thousands of people get a marketing
 * email about a cart they abandoned in 2024.
 */
const MARKER = '[abandoned-cart]'

const FIELDS = [
  'id', 'email', 'currency_code', 'completed_at', 'updated_at',
  'items.title', 'items.quantity', 'items.unit_price', 'items.variant_title', 'items.thumbnail',
  'customer.first_name', 'customer.last_name',
]

export default async function abandonedCartJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const env = process.env as Record<string, string | undefined>

  if (env.ABANDONED_CART_ENABLED?.trim().toLowerCase() !== 'true') {
    logger.info(`${MARKER} disabled (ABANDONED_CART_ENABLED is not "true") — nothing scanned.`)
    return
  }

  const storefrontUrl = (env.STOREFRONT_URL || '').replace(/\/+$/, '')
  if (!storefrontUrl) {
    logger.error(`${MARKER} STOREFRONT_URL is unset — every email would link nowhere. ` +
      `Not scanning.`)
    return
  }

  const offer = resolveOffer(env)
  logger.info(`${MARKER} offer: ${offer.detail}`)

  // Over-fetch on time only, then exclude in code WITH COUNTS. Filtering `completed_at` in the
  // query would hide recovered carts inside the database rather than reporting them, and a
  // journey that mails nobody because everything recovered must not look like a journey with
  // nothing to do.
  const oldestMs = Math.max(...DEFAULT_WINDOWS.map((w) => w.untilMs))
  const since = new Date(Date.now() - oldestMs).toISOString()

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  let carts: CartCandidate[]
  try {
    const { data } = await query.graph({ entity: 'cart', fields: FIELDS,
      filters: { updated_at: { $gte: since } } })
    carts = (data ?? []) as CartCandidate[]
  } catch (e: any) {
    logger.error(`${MARKER} could not read carts: ${e?.message ?? String(e)} — no emails sent.`)
    return
  }

  for (const c of carts) {
    const cu = (c as { customer?: { first_name?: string; last_name?: string } }).customer
    const name = [cu?.first_name, cu?.last_name].filter(Boolean).join(' ').trim()
    if (name) c.customer_name = name
  }

  const logPath = env.EMAIL_SEND_LOG || 'outputs/email-sends.jsonl'
  const sendLog = readSendLog(logPath, { existsSync, readFileSync: (p, enc) => readFileSync(p, enc) })

  const plan = planJourney(carts, sendLog, Date.now())
  logger.info(`${MARKER} ${summarisePlan(plan)}`)

  const toSend = plan.decisions.filter((d) => d.action === 'send')
  if (!toSend.length) return

  // **The race this closes: a cart completed between the scan and the send.** The scan may
  // take a while over a large table, and an abandoned-cart email arriving after the customer
  // has bought is the most visible mistake this journey can make. One extra query for the
  // whole batch, not one per cart.
  let recovered = new Set<string>()
  try {
    const { data } = await query.graph({ entity: 'cart', fields: ['id', 'completed_at'],
      filters: { id: toSend.map((d) => d.cart_id) } })
    recovered = new Set((data ?? [])
      .filter((c: { completed_at?: unknown }) => Boolean(c.completed_at))
      .map((c: { id: string }) => c.id))
  } catch (e: any) {
    // Cannot re-check: the polarity for this journey is that an unprovable state does not
    // send. Emailing someone about a cart they may have just bought is the worse mistake.
    logger.error(`${MARKER} could not re-check ${toSend.length} cart(s) for recovery: ` +
      `${e?.message ?? String(e)} — SENDING NOTHING rather than mailing a customer who has ` +
      `already bought.`)
    return
  }

  const io = nodeIo((level, message) => logger[level](message))
  let sent = 0, skipped = 0

  for (const d of toSend) {
    if (d.action !== 'send') continue
    if (recovered.has(d.cart_id)) {
      logger.info(`${MARKER} ${d.cart_id} completed between scan and send — not mailed.`)
      skipped++
      continue
    }
    const cart = carts.find((c) => c.id === d.cart_id)
    if (!cart) continue

    const template = env.ABANDONED_CART_URL_TEMPLATE || '/cart?cart_id={cart_id}'
    const cartUrl = storefrontUrl + template.replace('{cart_id}', encodeURIComponent(cart.id))

    const built = buildCartData(cart, d.step, { cartUrl, toMinor: toMinorUnits,
      ...(offer.state === 'offer' ? { offer: offer.offer } : {}) })
    if (!built.ok) {
      logger.error(`${MARKER} ${cart.id} step ${d.step} could not be built: ${built.reason}`)
      skipped++
      continue
    }

    const r = await dispatch({
      template: 'abandoned-cart',
      data: built.value as unknown as Record<string, unknown>,
      to: cart.email!.trim(),
      env, io,
      // The cart is not an order, so there is no order_id. `subject_id` is what makes a
      // second run of this job find the first run's send.
      subject_id: d.subject_id,
    })
    if (r.record.action === 'send' || r.record.action === 'preview') sent++
    else skipped++
  }

  logger.info(`${MARKER} run complete: dispatched=${sent} skipped=${skipped}`)
}

export const config = {
  name: 'abandoned-cart-journey',
  // Hourly. The step windows are hours wide, so an occasional missed run still delivers, and
  // a long outage produces `missed` rather than a burst.
  schedule: '0 * * * *',
}
