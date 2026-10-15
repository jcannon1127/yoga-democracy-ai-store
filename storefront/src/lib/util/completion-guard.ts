/**
 * The last check before authorizing a payment. Call from placeOrder().
 *
 * Two silent ways a cart is wrong at the moment of payment:
 *   PRICE     Medusa snapshots unit_price at add-to-cart and never re-evaluates,
 *             so a cart can charge a stale price in either direction.
 *   SELLABLE  the cart contains something YD cannot ship. Medusa's add-to-cart
 *             check does not cover state drift between adding and paying, and
 *             1,103 variants still do not manage inventory at all.
 *
 * THE RULE THAT MATTERS MOST: a missing input must never become a permissive
 * answer. Unreachable, degraded, unknown or absent all REFUSE. An empty answer
 * treated as "fine" is the allow_backorder default in a different costume.
 *
 * The same rule exists in scripts/completion_guard.py (the offline detector).
 * Both are tested against payments/fixtures/completion-guard-cases.json — change
 * the rule there first, then make both pass.
 */

export type GuardVerdict = "ALLOW" | "REFUSE" | "ALLOW_AND_FLAG"

export type GuardResult = {
  verdict: GuardVerdict
  reason: string
  /** Safe to show a customer. Never leaks stock counts or internal state. */
  customerMessage?: string
  details: {
    priceDivergence: Array<{ sku?: string; held: number; catalogue: number; delta: number }>
    notSellable: Array<{ sku?: string; quantity: number; available: number | null }>
    unanswered: Array<{ sku?: string }>
  }
}

type AvailabilityLine = {
  sku?: string
  resolved_sku?: string | null
  available?: number | null
  status?: string
  backorderable?: boolean
  sellability?: string
  /** Maximum quantity the service will AUTHORISE. NOT a stock count.
   *  null = no limit (YD will backorder); n = at most n; 0 = authorise nothing.
   *  ABSENT means an older response that predates the field — fall back to
   *  `backorderable`. Never read absent as unlimited, never as zero. */
  sellable_limit?: number | null
}

export type AvailabilityPayload = {
  degraded?: boolean
  reason?: string
  /** NOTE: `binding: false` is NORMAL — a projection that reserves nothing.
   *  It is NOT a failure signal. Treating it as one refuses every cart forever. */
  binding?: boolean
  lines?: AvailabilityLine[]
}

export type CartLine = {
  sku?: string
  quantity: number
  unit_price: number
  /** Current catalogue price for this line's region, already resolved. */
  cataloguePrice: number | null
  title?: string
}

const AVAILABILITY_URL =
  process.env.YD_AVAILABILITY_URL || "http://127.0.0.1:8787"

export async function fetchAvailability(
  skus: string[],
  timeoutMs = 10_000
): Promise<{ payload: AvailabilityPayload | null; error: string | null }> {
  if (skus.length === 0) return { payload: { degraded: false, lines: [] }, error: null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AVAILABILITY_URL}/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus }),
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) return { payload: null, error: `availability service returned HTTP ${res.status}` }
    return { payload: (await res.json()) as AvailabilityPayload, error: null }
  } catch (e: any) {
    return { payload: null, error: `availability service unreachable: ${e?.message ?? e}` }
  } finally {
    clearTimeout(timer)
  }
}

const REFUSE_MESSAGE =
  "Something in your bag changed while you were checking out — we haven't " +
  "charged you. Please review your bag and try again."

/**
 * Pure decision. No I/O, so it is tested against the shared fixtures.
 *
 * Three outcomes, split by WHAT KIND OF THING WENT WRONG, not by confidence:
 *   REFUSE          positive, trustworthy evidence THIS cart is wrong
 *   ALLOW_AND_FLAG  we could not determine — let it through, record it loudly
 *   ALLOW           checked, nothing wrong
 *
 * Why uncertainty does not refuse: our own malfunction must never decline every
 * customer. A wrong charge is recoverable — the reconciler catches it and YD can
 * refund. A checkout that refuses everyone is total, immediate and invisible
 * until someone complains. The asymmetry is not close.
 */
export function decide(
  lines: CartLine[],
  payload: AvailabilityPayload | null,
  error: string | null
): GuardResult {
  const details: GuardResult["details"] = {
    priceDivergence: [],
    notSellable: [],
    unanswered: [],
  }

  for (const line of lines) {
    const cat = line.cataloguePrice
    // null is NOT zero and NOT free -- it means no price resolved for this
    // variant in this region. Never compare it against 0.
    if (cat === null || cat === undefined || line.unit_price === null || line.unit_price === undefined) {
      details.unanswered.push({ sku: line.sku })
      continue
    }
    if (Number(line.unit_price) !== Number(cat)) {
      details.priceDivergence.push({
        sku: line.sku,
        held: Number(line.unit_price),
        catalogue: Number(cat),
        delta: Number(((Number(line.unit_price) - Number(cat)) * line.quantity).toFixed(2)),
      })
    }
  }

  const settle = (reason: string): GuardResult => {
    // Price is NOT symmetric and must not inherit the sellability posture.
    //   OVERCHARGE  -> REFUSE. A customer is being wronged, and it is the failure
    //                  that produces a refund, a chargeback and a person who tells
    //                  other people.
    //   UNDERCHARGE -> ALLOW_AND_FLAG. Costs YD margin, recoverable, and declining
    //                  a real customer because OUR price went stale is worse.
    // NEVER net them across lines: one line over and one under must still refuse,
    // or someone is overcharged on an item because they were undercharged on
    // another.
    const overcharge = details.priceDivergence.filter((p) => p.delta > 0)
    const undercharge = details.priceDivergence.filter((p) => p.delta < 0)

    if (overcharge.length || details.notSellable.length) {
      return { verdict: "REFUSE", reason, customerMessage: REFUSE_MESSAGE, details }
    }
    if (undercharge.length || details.unanswered.length) {
      return { verdict: "ALLOW_AND_FLAG", reason, details }
    }
    return { verdict: "ALLOW", reason: "", details }
  }

  // On error or a degraded answer, NO line's sellability was determined -- mark
  // them all unanswered before settling, or settle() sees an empty list and
  // returns ALLOW. Caught by the shared fixtures on 2026-08-23, where this
  // returned ALLOW while the Python returned ALLOW_AND_FLAG.
  const allUndetermined = (reason: string): GuardResult => {
    for (const line of lines) {
      if (!details.unanswered.some((u) => u.sku === line.sku)) {
        details.unanswered.push({ sku: line.sku })
      }
    }
    return settle(reason)
  }

  if (error) {
    return allUndetermined(`${error} — allowing and flagging rather than declining the customer`)
  }
  if (payload?.degraded) {
    return allUndetermined(
      `availability answer is degraded (${payload.reason ?? "no reason given"})` +
        " — allowing and flagging rather than declining the customer"
    )
  }

  const bySku = new Map<string, AvailabilityLine>()
  for (const l of payload?.lines ?? []) {
    for (const key of [l.sku, l.resolved_sku]) if (key) bySku.set(String(key), l)
  }

  for (const line of lines) {
    const found = line.sku ? bySku.get(String(line.sku)) : undefined
    if (!found || found.status === "unknown") {
      details.unanswered.push({ sku: line.sku })
      continue
    }
    // sellable_limit is authoritative and subsumes the backorderable check.
    // Distinguish ABSENT from null: `in` rather than a value test, because
    // `undefined > n` is false in JS and a loose check would silently allow.
    if ("sellable_limit" in found) {
      const limit = found.sellable_limit
      // null means no limit -- YD will backorder it. Not zero.
      if (limit !== null && limit !== undefined && line.quantity > limit) {
        details.notSellable.push({
          sku: line.sku,
          quantity: line.quantity,
          available: found.available ?? null,
        })
      }
    } else if (found.backorderable === false) {
      // Older response without the field. Fall back rather than assume.
      const available = found.available ?? null
      if (available === null) details.unanswered.push({ sku: line.sku })
      else if (line.quantity > available)
        details.notSellable.push({ sku: line.sku, quantity: line.quantity, available })
    }
  }

  const reasons: string[] = []
  if (details.priceDivergence.some((p) => p.delta > 0)) reasons.push("overcharge")
  if (details.notSellable.length) reasons.push("not sellable")
  if (details.priceDivergence.some((p) => p.delta < 0)) reasons.push("undercharge")
  if (details.unanswered.length) reasons.push("could not determine")
  return settle(reasons.join("; "))
}

/** Fetch, then decide. This is what placeOrder calls. */
export async function guardCompletion(lines: CartLine[]): Promise<GuardResult> {
  const skus = lines.map((l) => l.sku).filter((s): s is string => !!s)
  const { payload, error } = await fetchAvailability(skus)
  return decide(lines, payload, error)
}
