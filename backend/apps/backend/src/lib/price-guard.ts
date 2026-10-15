/**
 * The other half of the till: PRICE and PAYMENT PROVIDER.
 *
 * `completion-guard.ts` closed the sellability hole server-side and said, honestly, that price
 * was still enforced in exactly one client:
 *
 *   > "Price divergence therefore remains enforced in one client, which is the same class of
 *   >  hole this file closes for sellability."
 *
 * That sentence was right, and the reason it gave for leaving it — "the completion workflow's
 * cart fields do not carry a resolved catalogue price" — is also right and is not a dead end.
 * yd-pay's contribution is the way past it: the catalogue price is not *carried*, but it can be
 * *resolved*, with `query.graph` on `variant` under a `QueryContext` for the cart's own region
 * and currency. Resolving it is the difference between one client enforcing the rule and the
 * store enforcing it.
 *
 * This file holds only the DECISIONS, with no I/O, so the rule can be tested without a database,
 * a cart, or a running server — the same split `completion-guard.ts` uses.
 *
 * ── THE PRICE RULE HAS THREE POSTURES, NOT TWO ────────────────────────────────────────────────
 *
 *   OVERCHARGE   held > catalogue   REFUSE.  A customer is being charged more than the shop
 *                                            currently asks. This is the failure that produces
 *                                            a refund, a chargeback and an email.
 *   UNDERCHARGE  held < catalogue   ALLOW, and log it as a margin loss. It costs YD money and
 *                                            is recoverable. Declining a real customer over
 *                                            OUR stale price is the worse trade.
 *   UNDETERMINED no catalogue price ALLOW, and log it. A null price is NOT zero and NOT free.
 *
 * **The asymmetry is the whole rule.** A guard that refused all divergence would look stricter
 * and be worse: it would decline paying customers because our own price list moved.
 *
 * **Never netted across lines.** Two lines, one $10 over and one $10 under, is an overcharge on
 * a real garment plus a margin loss on another — not a clean cart. Netting hides both.
 *
 * ── WHY CENTS, AND NOT `!==` ON THE NUMBERS ───────────────────────────────────────────────────
 *
 * Medusa v2 carries prices as decimal majors, so `20.1 - 20.1` is not reliably `0` once either
 * side has been through arithmetic. Comparing rounded integer cents means a half-cent of float
 * noise cannot refuse a customer's order. This is a deliberate difference from the reference
 * implementation, which compared `Number(held) !== Number(catalogue)`.
 *
 * ── TWO KNOWN, DELIBERATE IMPRECISIONS, BOTH FAILING SAFE ─────────────────────────────────────
 *
 * The resolving context carries region and currency, but no customer group and no quantity. So a
 * customer-group price or a quantity-tier price resolves to the PUBLIC price here, or to null:
 *
 *   - a group price is lower than public   -> held < catalogue -> UNDERCHARGE -> allowed, logged
 *   - a quantity tier does not resolve     -> null             -> UNDETERMINED -> allowed, logged
 *
 * Both land in the permissive direction, so the imprecision produces log noise and never a
 * refused order. If YD ever introduces group pricing in earnest, add the group to the context —
 * until then this is a known gap with a known direction, not an unknown one.
 */

export type ProviderMode = 'allowlist' | 'denylist'

export type ProviderDecision = {
  mode: ProviderMode
  /** The provider that must not complete this cart, if any. */
  refused?: string
  /** True when the stronger check is not configured and the weaker one ran in its place. */
  weakened: boolean
}

/**
 * Which providers may complete a real customer order.
 *
 * ALLOWLIST, not denylist, and the direction is the point. A denylist answers *"is this specific
 * bad thing present"* and cannot see what nobody thought to name — a second manual provider, a
 * test gateway, a misconfigured one. An allowlist answers *"is anything present we did not
 * authorise"*, which is the question that catches an unknown. Here the unknown is a free order.
 *
 * **An unset allowlist does NOT refuse everything.** That is the catastrophic direction: it would
 * decline every customer. It falls back to the denylist and reports `weakened: true` so the caller
 * can say loudly that the strong check is not the one running — a weak check must never be able to
 * look like the strong one.
 *
 * Matching is by PREFIX because Medusa's session ids are `pp_<provider>_<id>`, and the configured
 * names are the provider halves.
 */
export function providerDecision(
  activeProviderIds: string[],
  opts: { permitted?: string[] | null; forbidden?: string[] | null }
): ProviderDecision {
  const permitted = (opts.permitted ?? []).filter(Boolean)
  if (permitted.length) {
    const refused = activeProviderIds.find(
      (id) => !permitted.some((p) => String(id).startsWith(p))
    )
    return { mode: 'allowlist', refused, weakened: false }
  }
  // `pp_system_default` marks an order paid without taking money. It is how this gets tested and
  // it must never be how a customer pays.
  const forbidden = (opts.forbidden ?? ['pp_system_default']).filter(Boolean)
  const refused = activeProviderIds.find((id) =>
    forbidden.some((f) => String(id).startsWith(f))
  )
  return { mode: 'denylist', refused, weakened: true }
}

export type PriceLine = {
  sku?: string
  quantity: number
  /** What the cart holds — snapshotted at add-to-cart and never re-evaluated by Medusa. */
  held: number | null | undefined
  /** What the shop asks for it right now. `null` means "did not resolve", never "free". */
  catalogue: number | null | undefined
}

export type PriceRow = {
  sku?: string
  held: number
  catalogue: number
  /** Signed, in major units, across the whole line. Positive = the customer is overcharged. */
  delta: number
}

export type PriceDecision = {
  overcharge: PriceRow[]
  undercharge: PriceRow[]
  undetermined: Array<{ sku?: string }>
}

const cents = (n: number) => Math.round(n * 100)

export function priceDecision(lines: PriceLine[]): PriceDecision {
  const out: PriceDecision = { overcharge: [], undercharge: [], undetermined: [] }
  for (const l of lines) {
    const held = l.held
    const cat = l.catalogue
    if (held === null || held === undefined || cat === null || cat === undefined) {
      out.undetermined.push({ sku: l.sku })
      continue
    }
    const h = cents(Number(held))
    const c = cents(Number(cat))
    if (h === c) continue
    const qty = Number(l.quantity ?? 1) || 1
    const row: PriceRow = {
      sku: l.sku,
      held: Number(held),
      catalogue: Number(cat),
      delta: Number((((h - c) * qty) / 100).toFixed(2)),
    }
    ;(h > c ? out.overcharge : out.undercharge).push(row)
  }
  return out
}

/** Customer-facing text for a refused overcharge. It explains the situation and promises the one
 *  thing the customer most needs to hear — that no money was taken. It deliberately does not name
 *  the price or the line: a completion endpoint that explains itself precisely is a price oracle
 *  for anyone holding the publishable key, which is everyone. */
export const OVERCHARGE_MESSAGE =
  "The price of something in your bag changed while you were checking out — we haven't charged " +
  'you. Please review your bag and try again.'

/** Customer-facing text for a refused payment provider. Says nothing about which provider or why. */
export const PROVIDER_MESSAGE = 'That payment method cannot be used to place an order.'

/**
 * Parse a comma-separated env list.
 *
 * Unset and empty BOTH yield `null`, and that collapse is deliberate. `YD_PERMITTED_...=` with
 * nothing after it is a config accident, and reading it as "an allowlist permitting nothing" would
 * refuse every customer — the one direction this guard must never take. So an empty value means
 * "not configured", which degrades to the denylist and warns.
 */
export function envList(raw: string | undefined): string[] | null {
  if (raw === undefined || raw === null) return null
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : null
}
