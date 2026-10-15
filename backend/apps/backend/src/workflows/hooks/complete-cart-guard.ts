import { completeCartWorkflow } from '@medusajs/medusa/core-flows'
import {
  MedusaError,
  ContainerRegistrationKeys,
  QueryContext,
} from '@medusajs/framework/utils'
import {
  guardCartCompletion,
  REFUSE_MESSAGE,
  MARKER,
  type GuardLine,
} from '../../lib/completion-guard'
import {
  providerDecision,
  priceDecision,
  envList,
  OVERCHARGE_MESSAGE,
  PROVIDER_MESSAGE,
  type PriceLine,
} from '../../lib/price-guard'

/**
 * Single unmistakable tokens, matching the storefront guard's, so ONE watcher sees both halves.
 *
 * yd-store found that "and flag" was not true on its side: the flag was a warning into a journal
 * nothing read, which made an undetermined sale operationally identical to a verified one. The
 * ALLOW_AND_FLAG posture only beats refusing if the record is actually read — otherwise it is
 * ALLOW with extra steps, and the trade this guard makes is not honest.
 *
 * These are deliberately ugly strings rather than prose: a grep for them cannot false-positive
 * on a comment, a customer's name, or a product title.
 */
const TOKEN_UNVERIFIED = 'YD_GUARD_UNVERIFIED'
const TOKEN_REFUSED = 'YD_GUARD_REFUSED'
/** A completed sale below the current catalogue price. Not a refusal — a number someone must read. */
const TOKEN_MARGIN = 'YD_GUARD_MARGIN_LOSS'

/**
 * WHY THESE CHECKS LIVE IN THIS HOOK AND NOT IN AN HTTP MIDDLEWARE.
 *
 * yd-pay wrote the price and provider checks as `defineMiddlewares()` on
 * `POST /store/carts/:id/complete`. Same rules, better home here, for two reasons and one cost.
 *
 * 1. COVERAGE. A route middleware guards a URL. This hook guards the workflow, so it also fires
 *    for an admin completion, a subscriber, or any future code path that completes a cart without
 *    going through that route. The whole lesson of the storefront guard was that protecting one
 *    caller is not protecting the store; protecting one URL is the same mistake one layer down.
 * 2. NO SECOND SELLABILITY IMPLEMENTATION. The middleware re-implemented the sellability check
 *    that already runs here. Two implementations on one path is the drift we have been paying for
 *    all week — one gets fixed and the other does not.
 *
 * THE COST, MEASURED RATHER THAN ASSUMED: from a workflow hook we do not choose the HTTP status.
 * `MedusaError.Types.NOT_ALLOWED` maps to **400**, not the 409 the middleware returned. 409 is
 * reachable via `Types.CONFLICT` — but the framework's error handler REPLACES the message on that
 * branch with *"The request conflicted with another request. You may retry the request with the
 * provided Idempotency-Key."* (`@medusajs/framework/dist/http/middlewares/error-handler.js`).
 * A customer whose price moved would be told about idempotency keys. **The message reaches the
 * shopper and the status code does not, so 400-with-the-real-message wins.** Asserted on the live
 * response in `price-guard-live.test.mjs`, not inferred from the source.
 */
const PERMITTED_ENV = 'YD_PERMITTED_PAYMENT_PROVIDERS'

/**
 * The till, moved server-side.
 *
 * Registered on `completeCartWorkflow`'s `validate` hook, which runs AFTER payment sessions are
 * validated and BEFORE the order is created. Throwing here aborts completion — no order, no
 * capture, nothing to unwind. Putting it any later would mean cancelling an order and restoring
 * stock, which is exactly the cleanup someone had to do by hand on 2026-08-23.
 *
 * It fires for EVERY caller of the Store API, which is the whole point: the storefront's own
 * `guardCompletion()` protects the storefront, and a request carrying only the publishable key —
 * a key that ships in the browser bundle — walked straight past it.
 */
/**
 * Price and payment-provider enforcement.
 *
 * Throws `MedusaError` to refuse. Anything else that goes wrong in here is logged and allowed:
 * our own machinery failing must not decline every customer. Same asymmetry as the sellability
 * half — a wrong sale is recoverable, a checkout that refuses everyone is total and invisible.
 */
async function guardPriceAndProvider(cart: any, container: any, logger: any): Promise<void> {
  const cartId = cart?.id
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // The hook's `cart` does not carry payment sessions or a resolved catalogue price. Re-read what
  // is actually needed rather than trusting whatever the workflow happened to hydrate.
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'region_id',
      'currency_code',
      'items.id',
      'items.quantity',
      'items.unit_price',
      'items.variant_id',
      'items.variant_sku',
      'payment_collection.payment_sessions.provider_id',
      'payment_collection.payment_sessions.status',
    ],
    filters: { id: cartId },
  })
  const full = carts?.[0]
  if (!full) {
    logger.warn(
      `${MARKER} ${TOKEN_UNVERIFIED} status=undetermined cart=${cartId} ` +
        `reason=cart_not_reloadable — price and provider were NOT checked.`
    )
    return
  }

  // ── 1. Only an authorised provider may complete a customer order ────────────────────────────
  const sessions = full.payment_collection?.payment_sessions ?? []
  const active = sessions
    .filter((s: any) => s.status === 'pending' || s.status === 'authorized')
    .map((s: any) => String(s.provider_id))
  const decision = providerDecision(active, {
    permitted: envList(process.env[PERMITTED_ENV]),
    forbidden: envList(process.env.YD_FORBIDDEN_PAYMENT_PROVIDERS),
  })
  if (decision.weakened) {
    logger.warn(
      `${MARKER} ${TOKEN_UNVERIFIED} status=weak_check cart=${cartId} reason=${PERMITTED_ENV}_unset ` +
        `— fell back to a DENYLIST, which cannot catch a provider nobody has named. ` +
        `Set ${PERMITTED_ENV} before launch.`
    )
  }
  if (decision.refused) {
    logger.error(
      `${MARKER} ${TOKEN_REFUSED} status=refused cart=${cartId} reason=payment_provider ` +
        `provider=${decision.refused} mode=${decision.mode} — completion blocked, nothing charged.`
    )
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, PROVIDER_MESSAGE)
  }

  // ── 2. Price. Resolved here, because the workflow does not carry it ─────────────────────────
  const items = (full.items ?? []).filter((i: any) => i.variant_id)
  if (!items.length) return

  let priced: PriceLine[]
  try {
    const { data: variants } = await query.graph({
      entity: 'variant',
      fields: ['id', 'calculated_price.*'],
      filters: { id: items.map((i: any) => i.variant_id) },
      context: {
        calculated_price: QueryContext({
          region_id: full.region_id,
          currency_code: full.currency_code,
        }),
      },
    })
    const byVariant = new Map<string, any>()
    for (const v of variants ?? []) byVariant.set(v.id, v)
    priced = items.map((i: any) => ({
      sku: i.variant_sku ?? undefined,
      quantity: Number(i.quantity ?? 1),
      held: i.unit_price,
      catalogue: byVariant.get(i.variant_id)?.calculated_price?.calculated_amount ?? null,
    }))
  } catch (e: any) {
    // Pricing unavailable must not decline a customer — but it must not look like a clean sale
    // either. This is the same "ran and could not see" state the sellability half flags.
    logger.error(
      `${MARKER} ${TOKEN_UNVERIFIED} status=undetermined cart=${cartId} reason=price_unresolvable ` +
        `error=${e?.message ?? String(e)} — ALLOWED WITHOUT A PRICE CHECK.`
    )
    return
  }

  const price = priceDecision(priced)

  if (price.overcharge.length) {
    logger.error(
      `${MARKER} ${TOKEN_REFUSED} status=refused cart=${cartId} reason=overcharge ` +
        `lines=${JSON.stringify(price.overcharge)} — completion blocked, nothing charged.`
    )
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, OVERCHARGE_MESSAGE)
  }

  // Allowed on purpose. Logged with its own token so a margin loss is countable rather than
  // buried among refusals — the flag is only worth having if someone can read it.
  for (const row of price.undercharge) {
    logger.error(
      `${MARKER} ${TOKEN_MARGIN} status=allowed cart=${cartId} sku=${row.sku} ` +
        `held=${row.held} catalogue=${row.catalogue} delta=${row.delta} — sold BELOW catalogue.`
    )
  }
  if (price.undetermined.length) {
    logger.error(
      `${MARKER} ${TOKEN_UNVERIFIED} status=undetermined cart=${cartId} reason=no_catalogue_price ` +
        `skus=${price.undetermined.map((u) => u.sku).join(',')} — ALLOWED WITHOUT A PRICE CHECK.`
    )
  }
}

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    await guardPriceAndProvider(cart, container, logger)
  } catch (e: any) {
    // A deliberate refusal must propagate. Anything else is a bug in this file and fails open.
    if (MedusaError.isMedusaError(e)) throw e
    logger.error(
      `${MARKER} ${TOKEN_UNVERIFIED} status=guard_error cart=${cart?.id} scope=price_provider ` +
        `error=${e?.message ?? String(e)} — price and provider were NOT checked for this order.`
    )
  }

  const lines: GuardLine[] = (cart?.items ?? []).map((i: any) => ({
    sku: i.variant_sku ?? undefined,
    quantity: Number(i.quantity ?? 0),
    title: i.title ?? undefined,
  }))

  // A cart of unidentifiable lines is not a clean cart. Without a SKU there is nothing to ask
  // the availability service about, so this is "could not determine" and must be as loud as any
  // other undetermined answer rather than an early, quiet return.
  const withoutSku = lines.filter((l) => !l.sku).length
  if (withoutSku) {
    logger.warn(
      `${MARKER} ${TOKEN_UNVERIFIED} status=undetermined cart=${cart?.id} ` +
        `reason=lines_without_sku count=${withoutSku} — these lines were NOT checked.`
    )
  }

  let result
  try {
    result = await guardCartCompletion(lines)
  } catch (e: any) {
    // The guard itself failing is not the same as a cart being wrong, and the two must never be
    // logged the same way — one is a bug in this file, the other is a customer's bag.
    // The guard itself failing means the sale went through unverified, so it carries the same
    // token as any other unverified completion — the watcher must not miss it just because the
    // cause was a bug in this file rather than an unreachable service.
    logger.error(
      `${MARKER} ${TOKEN_UNVERIFIED} status=guard_error cart=${cart?.id} ` +
        `error=${e?.message ?? String(e)} — the till did not run for this order.`
    )
    return
  }

  const skus = lines.map((l) => l.sku).filter(Boolean).join(',')

  if (result.verdict === 'REFUSE') {
    // The log carries yd-alloc's own `sellability` word per line, so a refusal reads
    // "while_stock_lasts" — Jeff's discontinued rule — rather than only "not backorderable".
    // Whoever reads this line at 2am should not have to go and ask why.
    logger.error(
      `${MARKER} ${TOKEN_REFUSED} status=refused cart=${cart?.id} reason=${result.reason} ` +
        `lines=${JSON.stringify(result.notSellable)} — completion blocked, nothing charged.`
    )
    // NOT_ALLOWED surfaces as a 400 with the message intact, so the storefront can show it. The
    // message deliberately says nothing about stock levels or which line failed: a completion
    // endpoint that explains itself precisely is an inventory oracle for anyone with the
    // publishable key.
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, REFUSE_MESSAGE)
  }

  if (result.verdict === 'ALLOW_AND_FLAG') {
    // LOUD, and distinct from a refusal. This is the line that tells someone the till ran and
    // could not see — as opposed to running and finding nothing wrong. Collapsing the two is
    // how a broken guard looks healthy.
    logger.error(
      `${MARKER} ${TOKEN_UNVERIFIED} status=undetermined cart=${cart?.id} ` +
        `reason=${result.reason} skus=${skus} — ALLOWED WITHOUT A SELLABILITY ANSWER. ` +
        `Not a clean completion.`
    )
    return
  }

  logger.info(`${MARKER} status=allowed cart=${cart?.id} lines=${lines.length}`)
})
