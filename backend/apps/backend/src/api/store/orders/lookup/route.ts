import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { findLegacyOrderForGuest } from '../../../../lib/legacy-orders'
import type { LegacyOrder } from '../../../../lib/legacy-orders'

/**
 * Guest order tracking — order number + email, no account.
 *
 * The live SFCC site has this (`Order-Track`) and Medusa v2 does not: `GET /store/orders` is
 * hard-scoped to `req.auth_context.actor_id`, so there is no guest path in the platform at
 * all. Without this route, a guest who wants to know where their order is has exactly one
 * option — email CS. YD has no returns portal either, so CS is already absorbing everything.
 *
 * ── The security shape, because this is the one route on the storefront that hands over
 *    order data to an unauthenticated caller ────────────────────────────────────────────
 *
 * An order number plus an email is a weak credential: order numbers are sequential-ish and
 * emails are guessable. Three things follow, and all three are deliberate:
 *
 * 1. **Every failure returns the same 404 with the same body.** Wrong number, wrong email,
 *    right number with the wrong email — indistinguishable. If a wrong email returned 403
 *    while a wrong number returned 404, this route would confirm which order numbers exist.
 * 2. **The response is a redacted projection, never the raw order.** No payment data, no
 *    customer id, no billing address, no email echoed back. A caller who guesses correctly
 *    learns what the buyer already knows, not a profile.
 * 3. **Throttled per client.** Not a substitute for the above, but it turns "enumerate 10,000
 *    order numbers" into something that shows up rather than something that finishes.
 *
 * ── Order numbers ──────────────────────────────────────────────────────────────────────
 *
 * Medusa numbers orders with an integer `display_id`. Every order YD has taken for eleven
 * years is numbered `PROD…` in SFCC. Customers hold the SFCC numbers, on emails we did not
 * send and cannot recall, so a lookup that only understands `display_id` would fail for the
 * entire history the moment migration lands. Both are accepted; the legacy key is config.
 */

const LEGACY_ORDER_NUMBER_KEY =
  process.env.LEGACY_ORDER_NUMBER_METADATA_KEY || 'legacy_order_number'

// VERBATIM FROM THE LIVE SITE — this is parity, not a phrasing choice.
//
// yogademocracy.com's `Order-Track` returns exactly this one message for every failure mode:
// wrong number, wrong email, wrong postal code, or all three. It never reveals which field was
// wrong or whether the order exists. Keeping the wording identical is the point: "match the
// live site" is an instruction the next person will follow, whereas a note about
// indistinguishable errors reads as a rough edge somebody smooths into a leak.
//
// It matters because YD's order numbers are sequential (`PROD00018667`). An error that
// distinguished "no such order" from "email does not match" would turn this route into an
// order-number enumeration oracle.
const NOT_FOUND = {
  message:
    'Sorry this order number, email or postal code does not match our records. ' +
    'Check your records and try again.',
  type: 'not_found',
}

// Per-client throttle. In-memory on purpose: this is one process today, and a Redis-backed
// limiter that is never exercised is worth less than a simple one that is.
const WINDOW_MS = Number(process.env.ORDER_LOOKUP_WINDOW_MS || 60_000)
const MAX_PER_WINDOW = Number(process.env.ORDER_LOOKUP_MAX_PER_WINDOW || 10)
const hits = new Map<string, number[]>()

function throttled(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k)
    }
  }
  return recent.length > MAX_PER_WINDOW
}

type LookupBody = { order_number?: unknown; email?: unknown; postal_code?: unknown }

// The live SFCC `Order-Track` asks for order number, email AND postal code, and answers every
// failure with one combined error. This is parity with that, not a security flourish invented
// here — which matters, because "match the live site" is an instruction that survives being
// handed to someone else, and "return indistinguishable errors" is one somebody eventually
// smooths into a leak.
const REQUIRE_POSTAL = (process.env.ORDER_LOOKUP_REQUIRE_POSTAL ?? 'true') !== 'false'


export async function POST(req: MedusaRequest<LookupBody>, res: MedusaResponse) {
  const rawNumber = typeof req.body?.order_number === 'string' ? req.body.order_number.trim() : ''
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  const rawPostal = typeof req.body?.postal_code === 'string' ? req.body.postal_code.trim() : ''

  // A missing input is a bad request, not a permissive lookup. This is the one distinction
  // the route is allowed to make, because it reveals nothing about which orders exist.
  if (!rawNumber || !rawEmail || (REQUIRE_POSTAL && !rawPostal)) {
    return res.status(400).json({
      message: REQUIRE_POSTAL
        ? 'An order number, an email address and a postal code are all required.'
        : 'Both an order number and an email address are required.',
      type: 'invalid_data',
    })
  }

  const clientKey =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  if (throttled(clientKey)) {
    return res.status(429).json({
      message: 'Too many lookups. Please wait a minute and try again.',
      type: 'rate_limited',
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // WHY THE EMAIL IS THE FILTER AND THE ORDER NUMBER IS NOT.
  //
  // The obvious shape is "find the order with this number, then check the email". It does not
  // work, and the way it fails is worth recording: filtering on `metadata.legacy_order_number`
  // makes Medusa's query layer read `metadata` as a RELATION, and Postgres answers
  // `missing FROM-clause entry for table "metadata"`. Every lookup 500s. That is not merely a
  // bug — a 500 on all misses and a 200 on a hit is exactly the oracle this route is written to
  // avoid, so the naive version leaks precisely what the careful error handling protects.
  //
  // `email` is a real, indexed column on `order`. Filter on it, then match the number in JS.
  // A customer's order count is small (YD's most frequent buyer has 41 in a year), the
  // comparison then works for BOTH numbering schemes without a JSONB filter, and it does not
  // commit this route to a decision that belongs to whoever runs the migration.
  //
  // `$ilike` with the wildcards escaped is an exact, case-insensitive match. Migrated SFCC
  // emails cannot be assumed lower-cased, and a case-sensitive compare would silently fail for
  // every customer who typed a capital letter when they ordered.
  const escapedEmail = rawEmail.replace(/[\\%_]/g, (c) => `\\${c}`)

  let candidates: any[] = []
  try {
    const result = await query.graph({
      entity: 'order',
      fields: [
        'id',
        'display_id',
        'status',
        'created_at',
        'email',
        'currency_code',
        'total',
        'subtotal',
        'shipping_total',
        'tax_total',
        'discount_total',
        'metadata',
        'items.*',
        'shipping_address.*',
        'fulfillments.*',
        'fulfillments.labels.*',
      ],
      filters: { email: { $ilike: escapedEmail } } as any,
    })
    candidates = result.data || []
  } catch (e: any) {
    // Loud here, uniform to the caller. The query no longer varies with the order number, so a
    // fault is a fault for every input equally and cannot be used to probe for existence — but
    // it WOULD look identical to "no such order" from the outside, which is how a broken
    // lookup would sit in production being read as a customer typo.
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(
      `[order-lookup] status=failed error=${e?.message ?? String(e)} ` +
        `— guest order tracking is DOWN and every customer is seeing "we could not find it".`
    )
    return res.status(503).json({
      message: 'Order lookup is temporarily unavailable. Please try again shortly.',
      type: 'service_unavailable',
    })
  }

  // Accepts what a customer actually holds: `PROD00007839` off an eleven-year-old SFCC
  // confirmation, `#1234`, or a bare Medusa `display_id`. Comparison is on the digits, so the
  // prefix and the zero padding do not have to be guessed correctly.
  const digitsOf = (v: string) => {
    const d = v.replace(/\D+/g, '')
    return d ? String(Number(d)) : ''
  }
  const wantedRaw = rawNumber.trim().toUpperCase()
  const wantedDigits = digitsOf(rawNumber)

  // Postal code is compared with spaces and case removed: "46220" vs "46220", but also
  // "K1A 0B1" vs "k1a0b1". A customer who formats their own postcode differently from the way
  // it was stored has not failed to prove who they are.
  const normalisePostal = (v: unknown) =>
    typeof v === 'string' ? v.replace(/[\s-]+/g, '').toUpperCase() : ''
  const wantedPostal = normalisePostal(rawPostal)

  const order = (candidates || []).find((o: any) => {
    // Folded into the same predicate on purpose: a postal-code mismatch must be the same
    // outcome as a wrong order number, not a separate branch someone can turn into its own
    // error message later.
    if (REQUIRE_POSTAL) {
      const stored = normalisePostal(o?.shipping_address?.postal_code)
      if (!stored || stored !== wantedPostal) return false
    }
    const legacy = o?.metadata?.[LEGACY_ORDER_NUMBER_KEY]
    if (typeof legacy === 'string' && legacy.trim().toUpperCase() === wantedRaw) return true
    if (typeof legacy === 'string' && wantedDigits && digitsOf(legacy) === wantedDigits) return true
    if (o?.display_id != null && wantedDigits && String(o.display_id) === wantedDigits) return true
    return false
  })

  // Fall back to SFCC history. 120,783 historical orders live in `legacy_order`, against 0
  // native Medusa orders today — so for a long time after launch this branch, not the one
  // above, is what a guest lookup actually finds. Trying Medusa first is still correct: a
  // customer chasing a parcel is almost always chasing a recent one.
  if (!order) {
    let legacy: LegacyOrder | null = null
    try {
      legacy = await findLegacyOrderForGuest(
        req.scope, rawNumber, rawEmail, rawPostal, REQUIRE_POSTAL
      )
    } catch (e: any) {
      const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
      logger.error(
        `[order-lookup] status=failed scope=legacy error=${e?.message ?? String(e)} ` +
          `— historical order lookup is DOWN; guests are being told their order does not exist.`
      )
      return res.status(503).json({
        message: 'Order lookup is temporarily unavailable. Please try again shortly.',
        type: 'service_unavailable',
      })
    }

    if (legacy) {
      return res.status(200).json({
        order: {
          order_number: legacy.order_number,
          status: legacy.status,
          placed_at: legacy.placed_at,
          currency_code: legacy.currency_code,
          totals: {
            subtotal: legacy.subtotal,
            shipping: legacy.shipping_total,
            tax: legacy.tax_total,
            discount: legacy.discount_total,
            total: legacy.total,
          },
          items: legacy.items.map((i) => ({
            title: i.title,
            variant_title: null,
            sku: i.sku,
            quantity: i.quantity,
            thumbnail: null,
            unit_price: i.unit_price,
          })),
          ship_to: legacy.ship_to
            ? {
                name: (legacy.ship_to as any).name ?? null,
                city: (legacy.ship_to as any).city ?? null,
                province: (legacy.ship_to as any).province ?? null,
                postal_code: (legacy.ship_to as any).postal_code ?? null,
                country_code: (legacy.ship_to as any).country_code ?? null,
              }
            : null,
          // No shipments: SFCC's shipment records cannot be joined to order lines, so any
          // per-parcel state shown here would be invented. An empty list with `is_legacy` set
          // lets the page say "we cannot show tracking for older orders" instead of implying
          // nothing shipped.
          shipments: [],
          is_legacy: true,
        },
      })
    }
  }

  // Wrong number, wrong email, and right-number-wrong-email collapse to one answer. See note 1.
  if (!order) {
    return res.status(404).json(NOT_FOUND)
  }

  const addr = order.shipping_address || null

  // Redacted projection. Adding a field here is a security decision, not a formatting one.
  return res.status(200).json({
    order: {
      order_number:
        order.metadata?.[LEGACY_ORDER_NUMBER_KEY] ??
        (order.display_id != null ? String(order.display_id) : null),
      status: order.status,
      placed_at: order.created_at,
      currency_code: order.currency_code,
      totals: {
        subtotal: order.subtotal,
        shipping: order.shipping_total,
        tax: order.tax_total,
        discount: order.discount_total,
        total: order.total,
      },
      items: (order.items || []).map((i: any) => ({
        title: i.title,
        variant_title: i.variant_title,
        sku: i.variant_sku ?? null,
        quantity: i.quantity,
        thumbnail: i.thumbnail ?? null,
        unit_price: i.unit_price,
      })),
      // Enough to confirm "yes, this is my order" — not enough to harvest.
      ship_to: addr
        ? {
            name: [addr.first_name, addr.last_name].filter(Boolean).join(' ') || null,
            city: addr.city ?? null,
            province: addr.province ?? null,
            postal_code: addr.postal_code ?? null,
            country_code: addr.country_code ?? null,
          }
        : null,
      shipments: (order.fulfillments || []).map((f: any) => ({
        shipped_at: f.shipped_at ?? null,
        delivered_at: f.delivered_at ?? null,
        tracking: (f.labels || []).map((l: any) => ({
          number: l.tracking_number ?? null,
          url: l.tracking_url ?? null,
        })),
      })),
    },
  })
}
