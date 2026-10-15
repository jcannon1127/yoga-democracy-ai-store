import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * Read-only access to SFCC order history.
 *
 * These orders live in `legacy_order` / `legacy_order_line` rather than Medusa's `order`
 * table, because `ShipmentItem` cannot be joined to order lines in the Salesforce export —
 * both foreign keys are null across all 220,102 rows — so line-level fulfilment state is
 * unanswerable. A Medusa `order` row would imply a state machine nothing can back. See
 * `migrations/001-legacy-order-history.sql`.
 *
 * Shared by the account area and by guest order lookup so that a customer sees the SAME order
 * whether they sign in or type their order number. Two code paths reading history two
 * different ways is how they end up disagreeing.
 */

const ORG_ID = process.env.ORG_ID || 'yd'

export type LegacyOrder = {
  id: string
  order_number: string
  placed_at: string | null
  status: string | null
  currency_code: string | null
  total: number | null
  subtotal: number | null
  shipping_total: number | null
  tax_total: number | null
  discount_total: number | null
  ship_to: Record<string, unknown> | null
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

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function shape(row: any, lines: any[]): LegacyOrder {
  return {
    id: row.id,
    order_number: row.order_number,
    placed_at: row.ordered_at,
    status: row.status,
    currency_code: (row.currency_code || 'usd').toLowerCase(),
    total: num(row.total),
    subtotal: num(row.subtotal),
    shipping_total: num(row.shipping_total),
    tax_total: num(row.tax_total),
    discount_total: num(row.discount_total),
    ship_to: row.ship_to || null,
    items: lines.map((l) => ({
      title: l.title,
      sku: l.sku,
      quantity: num(l.quantity),
      unit_price: num(l.unit_price),
      total_price: num(l.total_price),
      status: l.status,
    })),
    // The storefront MUST be able to tell these apart from Medusa orders: a legacy order has
    // no returns, no reorder and no live tracking, and offering those actions on an order the
    // platform cannot act on is worse than not showing them.
    is_legacy: true,
  }
}

async function withLines(knex: any, rows: any[]): Promise<LegacyOrder[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  // Shipping and delivery charges are stored but not shown. The order total already includes
  // them, so listing "STANDARD SHIPPING" beside the garments reads as a second product — which
  // is exactly how the first version of this looked in a real customer's history. They are
  // filtered here rather than dropped at import: data that was never loaded cannot be
  // reconsidered, and `is_charge` is derived from the Product2Id Salesforce assigned rather
  // than from the line's name.
  const lines = await knex('legacy_order_line')
    .whereIn('legacy_order_id', ids)
    .andWhere('org_id', ORG_ID)
    .andWhere('is_charge', false)
    .orderBy('line_number', 'asc')
  const byOrder = new Map<string, any[]>()
  for (const l of lines) {
    const arr = byOrder.get(l.legacy_order_id) || []
    arr.push(l)
    byOrder.set(l.legacy_order_id, arr)
  }
  return rows.map((r) => shape(r, byOrder.get(r.id) || []))
}

/**
 * A signed-in customer's history.
 *
 * MATCHED ON `customer_id` ALONE. The email is deliberately NOT used, and this is the most
 * important line in the file.
 *
 * The first version also matched `lower(email) = the signed-in customer's email`, reasoning
 * that the email came from the authenticated customer record and so could be trusted. It
 * could not, and the hole was demonstrated rather than theorised:
 *
 *   1. Imported customers land with NO auth identity (no password migrates from SFCC).
 *   2. Medusa lets anyone register an email that already belongs to a customer — it creates a
 *      SECOND customer row with the same address. Verified: two rows, same email.
 *   3. That second customer is authenticated, and its email matched the first customer's
 *      orders. A stranger who guessed a customer's email was shown their entire history —
 *      names, addresses, items, totals — from an account they had simply signed up for.
 *
 * Email is a label a human types, not an identity Medusa verifies. `customer_id` is assigned
 * by the system and is the only thing here that means anything. The 8,992 orders that resolve
 * to no `customer_id` are unreachable through the account area as a result, and that is the
 * correct trade: they are equally unreachable to an attacker, and they are counted rather than
 * quietly reattached by address.
 *
 * Guest lookup is a different case and legitimately uses the email — there it is one of THREE
 * factors alongside an order number and a postal code, which is a claim to check, not an
 * identity to trust.
 */
export async function listLegacyOrdersForCustomer(
  scope: any,
  customerId: string,
  _email: string | null,
  limit = 50,
  offset = 0
): Promise<{ orders: LegacyOrder[]; count: number }> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const base = () =>
    knex('legacy_order').where('org_id', ORG_ID).andWhere('customer_id', customerId)

  const [{ count }] = await base().count({ count: '*' })
  const rows = await base()
    .orderBy('ordered_at', 'desc')
    .limit(limit)
    .offset(offset)

  return { orders: await withLines(knex, rows), count: Number(count) }
}

/**
 * Guest lookup by order number, then email, then postal code.
 *
 * Every argument is attacker-controlled, so the caller gets one identical answer for every
 * failure — see the lookup route. This returns null for "no match" and never explains which
 * field was wrong.
 */
export async function findLegacyOrderForGuest(
  scope: any,
  orderNumber: string,
  email: string,
  postalCode: string | null,
  requirePostal: boolean
): Promise<LegacyOrder | null> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  // Email is the filter because it is indexed and because it bounds the candidate set to one
  // person's own orders before any number matching happens. A customer has at most ~100.
  const rows = await knex('legacy_order')
    .where('org_id', ORG_ID)
    .andWhereRaw('lower(email) = ?', [email.trim().toLowerCase()])

  if (!rows.length) return null

  const norm = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '')
  const digits = (v: string) => {
    const d = (v || '').replace(/\D+/g, '')
    return d ? String(Number(d)) : ''
  }
  const wanted = norm(orderNumber)
  const wantedDigits = digits(orderNumber)

  // Exact match first, ALWAYS. The digit-only fallback exists so a customer can type `7839`
  // off an old `PROD00007839` confirmation — but YD's numbering includes shapes like `4890-L`
  // and `1003-…`, so digits alone can collide between two of one customer's own orders. When
  // the loose match is ambiguous it is refused rather than guessed: showing someone the wrong
  // order is worse than asking them to type the whole number.
  const exact = rows.filter((r: any) => norm(r.order_number || '') === wanted)
  let candidates = exact
  if (!candidates.length && wantedDigits) {
    const loose = rows.filter((r: any) => digits(r.order_number || '') === wantedDigits)
    if (loose.length === 1) candidates = loose
  }
  if (candidates.length !== 1) return null

  const row = candidates[0]

  if (requirePostal) {
    const stored = String((row.ship_to || {}).postal_code || '')
      .replace(/[\s-]+/g, '')
      .toUpperCase()
    const given = String(postalCode || '').replace(/[\s-]+/g, '').toUpperCase()
    // No stored postal code means this order can NEVER pass a postal check — 9,662 orders are
    // in that state. Failing closed is right (the alternative is skipping the check whenever
    // the data is thin, which turns a missing input into a permissive answer), but it is why
    // the guest-lookup detector reports that population rather than leaving it invisible.
    if (!stored || stored !== given) return null
  }

  return (await withLines(knex, [row]))[0] ?? null
}
