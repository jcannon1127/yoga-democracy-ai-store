/**
 * Server-side completion guard — the till.
 *
 * WHY THIS EXISTS. `guardCompletion()` in the storefront is called from the Next.js
 * `placeOrder()`, so it protects exactly one client. Anything reaching Medusa's Store API
 * directly skips it entirely, and on 2026-08-23 that is what happened: a discontinued garment
 * (`1610L001`) completed an order, and separately 500 units of an unmanaged variant were
 * accepted using nothing but the publishable key — a key that ships inside the storefront's
 * JavaScript bundle. The shelf was server-side and the till was not.
 *
 * WHAT THIS IS NOT. It does NOT re-implement Medusa's own inventory check, which works and is
 * proven. Medusa checks its STORED figures; this checks yd-alloc's LIVE answer, which is a
 * different and more current source. One rule, one source — not a parallel quantity rule, which
 * is the drift yd-store was right to warn about.
 *
 * SCOPE, STATED HONESTLY. This file covers SELLABILITY only.
 *
 * **CLOSED 2026-08-25 — the price half is now enforced server-side too, in `price-guard.ts`.**
 * This paragraph used to end "price divergence therefore remains enforced in one client, which is
 * the same class of hole this file closes for sellability", and the reason it gave for leaving it
 * was that the completion workflow's cart fields carry no resolved catalogue price. That was true
 * and it was not a dead end: the price is not *carried*, but it can be *resolved*, via
 * `query.graph` on `variant` under a `QueryContext` for the cart's own region and currency
 * (yd-pay's finding). Both halves now run from the same `complete-cart-guard.ts` hook.
 *
 * A NOTE ON WHICH NUMBER IS AUTHORITATIVE. yd-alloc exposes both `available` and
 * `sellable_limit`, and its own till-case script treats `sellable_limit` as the authority. The
 * shared rule compares against `available`. Measured across 400 SKUs, `sellable_limit` is never
 * BELOW `available`, so the two cannot currently disagree in the permissive direction — but if
 * that ever changes, `sellable_limit` is the stricter number and the fixtures should move to it.
 * Recorded so the choice is a known one rather than an accident.
 *
 * DRIFT CONTROL. The decision below mirrors the sellability branch of
 * `storefront/src/lib/util/completion-guard.ts` and is tested against the SAME fixture file,
 * `payments/fixtures/completion-guard-cases.json`. Change the rule in the fixtures first, then
 * make every implementation pass. Three implementations sharing one fixture set is survivable;
 * three implementations each with their own idea of the rule is not.
 */

export type GuardVerdict = 'ALLOW' | 'REFUSE' | 'ALLOW_AND_FLAG'

export type AvailabilityLine = {
  sku?: string
  resolved_sku?: string | null
  available?: number | null
  status?: string
  backorderable?: boolean
  sellability?: string
}

export type AvailabilityPayload = {
  degraded?: boolean
  reason?: string
  /** `binding: false` is NORMAL — a projection that reserves nothing. Not a failure signal.
   *  Treating it as one refuses every cart forever. */
  binding?: boolean
  lines?: AvailabilityLine[]
}

export type GuardLine = { sku?: string; quantity: number; title?: string }

export type GuardResult = {
  verdict: GuardVerdict
  reason: string
  notSellable: Array<{
    sku?: string
    quantity: number
    available: number | null
    /** yd-alloc's own word for WHY, carried through to the log. See the note below. */
    sellability?: string
  }>
  unanswered: Array<{ sku?: string }>
}

const AVAILABILITY_URL = process.env.YD_AVAILABILITY_URL || 'http://127.0.0.1:8787'

/**
 * What to do when sellability could not be determined at all.
 *
 * DEFAULT IS `flag`, MATCHING THE STOREFRONT GUARD'S DOCUMENTED RULE, AND THE DISAGREEMENT IS
 * DELIBERATE RATHER THAN OVERSIGHT — it has been raised with yd-store, which owns the decision.
 *
 * The reasoning the storefront guard records, which applies with more force here: a wrong charge
 * is recoverable — the reconciler catches it and YD refunds. A checkout that refuses everyone is
 * total, immediate, and invisible until a customer complains. The availability service is backed
 * by a Google Sheet the team edits; if it is briefly unreachable, refusing every completion turns
 * somebody's spreadsheet outage into a closed shop.
 *
 * That is NOT the same as "a missing input becomes a permissive answer". A missing input here is
 * loud: it is logged at error level with a distinct marker, and it never allows a line that has a
 * POSITIVE answer saying it is unsellable. Uncertainty elsewhere does not excuse positive evidence.
 *
 * Set `COMPLETION_GUARD_ON_UNKNOWN=refuse` to flip it without a code change if YD decides the
 * other way.
 */
const ON_UNKNOWN = (process.env.COMPLETION_GUARD_ON_UNKNOWN || 'flag').toLowerCase()

export const MARKER = '[completion-guard]'

export async function fetchAvailability(
  skus: string[],
  timeoutMs = 10_000
): Promise<{ payload: AvailabilityPayload | null; error: string | null }> {
  if (skus.length === 0) return { payload: { degraded: false, lines: [] }, error: null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AVAILABILITY_URL}/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skus }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { payload: null, error: `availability service returned HTTP ${res.status}` }
    }
    return { payload: (await res.json()) as AvailabilityPayload, error: null }
  } catch (e: any) {
    return { payload: null, error: `availability service unreachable: ${e?.message ?? e}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Pure decision. No I/O, so the shared fixtures can drive it directly. */
export function decideSellability(
  lines: GuardLine[],
  payload: AvailabilityPayload | null,
  error: string | null
): GuardResult {
  const notSellable: GuardResult['notSellable'] = []
  const unanswered: GuardResult['unanswered'] = []

  const settle = (reason: string): GuardResult => {
    // Positive evidence that THIS cart is wrong refuses, even when other lines could not be
    // determined. Uncertainty elsewhere never excuses it.
    if (notSellable.length) return { verdict: 'REFUSE', reason, notSellable, unanswered }
    if (unanswered.length) {
      return {
        verdict: ON_UNKNOWN === 'refuse' ? 'REFUSE' : 'ALLOW_AND_FLAG',
        reason,
        notSellable,
        unanswered,
      }
    }
    return { verdict: 'ALLOW', reason: '', notSellable, unanswered }
  }

  // On an error or a degraded answer NO line was determined. Mark them all before settling —
  // otherwise settle() sees an empty list and returns ALLOW, which is the shared fixtures'
  // 2026-08-23 catch where the TypeScript said ALLOW and the Python said ALLOW_AND_FLAG.
  const allUndetermined = (reason: string): GuardResult => {
    for (const line of lines) {
      if (!unanswered.some((u) => u.sku === line.sku)) unanswered.push({ sku: line.sku })
    }
    return settle(reason)
  }

  if (error) return allUndetermined(error)
  if (payload?.degraded) {
    return allUndetermined(
      `availability answer is degraded (${payload.reason ?? 'no reason given'})`
    )
  }

  const bySku = new Map<string, AvailabilityLine>()
  for (const l of payload?.lines ?? []) {
    for (const key of [l.sku, l.resolved_sku]) if (key) bySku.set(String(key), l)
  }

  for (const line of lines) {
    const found = line.sku ? bySku.get(String(line.sku)) : undefined
    if (!found || found.status === 'unknown') {
      unanswered.push({ sku: line.sku })
      continue
    }
    // The single boolean yd-alloc exposes. False means refuse any quantity beyond what is
    // physically available, whatever Medusa's own catalogue flag says. This is where Jeff's
    // rule lands — "if an item is discontinued, you don't offer backorder sales" — because
    // yd-alloc derives it from the team's own Discontinued tab, not from Medusa state.
    if (found.backorderable === false) {
      const available = found.available ?? null
      if (available === null) unanswered.push({ sku: line.sku })
      else if (line.quantity > available) {
        // `sellability` is RECORDED, never used to decide — deliberately.
        //
        // yd-alloc asked that this read `sellability` rather than infer from `backorderable`,
        // and it is right that the field is the explicit signal: "while_stock_lasts" IS Jeff's
        // discontinued rule (sell the last ones, never backorder) and is distinguishable from
        // "in_stock" or "backorderable" with a limit, which is a temporary refusal.
        //
        // But the VERDICT still turns on `backorderable === false`, because that is the rule in
        // payments/fixtures/completion-guard-cases.json, which the storefront guard and the
        // Python detector also implement. Changing the decision here alone would make three
        // implementations disagree — the precise drift this shared fixture set exists to stop.
        // If sellability should ever change a verdict, it goes in the fixtures first and all
        // three follow. Today it changes no outcome, so carrying it into the log is pure gain:
        // "refused: discontinued" is diagnosable and "refused: not backorderable" is not.
        notSellable.push({
          sku: line.sku,
          quantity: line.quantity,
          available,
          sellability: found.sellability,
        })
      }
    }
  }

  const reasons: string[] = []
  if (notSellable.length) reasons.push('not sellable')
  if (unanswered.length) reasons.push('could not determine')
  return settle(reasons.join('; '))
}

export async function guardCartCompletion(lines: GuardLine[]): Promise<GuardResult> {
  const skus = lines.map((l) => l.sku).filter((s): s is string => !!s)
  const { payload, error } = await fetchAvailability(skus)
  return decideSellability(lines, payload, error)
}

/** Safe to show a customer. Never leaks stock counts or internal state. */
export const REFUSE_MESSAGE =
  "Something in your bag changed while you were checking out — we haven't charged you. " +
  'Please review your bag and try again.'
