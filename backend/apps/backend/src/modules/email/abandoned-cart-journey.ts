/**
 * WHO GETS AN ABANDONED-CART EMAIL, WHICH STEP, AND — MOSTLY — WHO DOES NOT.
 *
 * This is the last piece of the lane that is a **timer rather than an event**. No Medusa event
 * says "this cart has been quiet for a day"; the only way to know is to look, on a schedule.
 * That changes the failure modes completely, and the two that matter both come from the job
 * running at a time nobody expected.
 *
 * ── 1. THE DUPLICATE, AND WHY "CANNOT TELL" RESOLVES THE OPPOSITE WAY HERE ────────────────
 *
 * Every other decision in this lane resolves an unreadable state toward **sending**, because a
 * missing shipment notice costs a customer their tracking number while a redundant one costs
 * nothing. **Here it resolves toward NOT sending, and the reversal is deliberate.**
 *
 * "You left something behind" arriving four times is not a redundancy, it is a spam complaint.
 * Complaints are scored per sending domain, so the damage lands on **every** email YD sends —
 * including the order confirmations and password resets that genuinely must arrive. **A missed
 * marketing email costs one conversion; a duplicate one degrades the deliverability of the
 * mail that cannot fail.** So whenever the send log cannot prove a step has NOT already gone
 * out — missing, unreadable, holding malformed lines, or simply beginning after this cart was
 * last touched — the answer is `hold`, and `hold` never sends.
 *
 * **The same "we cannot tell" state, resolved in opposite directions in one lane, is not an
 * inconsistency. It is the same rule — take the cheaper mistake — applied to costs that point
 * in opposite directions.**
 *
 * ── 2. THE CATCH-UP STORM ─────────────────────────────────────────────────────────────────
 *
 * If the job stops for a weekend and starts on Monday, every cart from Friday is "older than
 * an hour". A step defined only by a lower bound fires all of them at once: *"You left
 * something behind!"* about a cart the customer forgot three days ago, arriving in a burst
 * that looks exactly like a compromised sender.
 *
 * **So a step is a WINDOW, with an end.** Past the end the step is `missed` — recorded,
 * counted, reported, and never fired late. A step that was missed stays missed; the later
 * steps still run on their own windows, because each is independent and there is no state
 * machine to wedge.
 *
 * ── 3. EVERY EXCLUSION IS COUNTED AND RETURNED ────────────────────────────────────────────
 *
 * From yd-promo, after an aggregate that silently dropped rows dropped exactly the rows that
 * would have contradicted it: **make the query report what it excluded.** `planJourney`
 * returns a count for every reason a cart was dropped, and the job logs them. A journey that
 * mails nobody because every cart lacks an email address must not look like a journey with
 * nothing to do.
 */
import { coverageStamps } from "./reconcile.ts"
import { deliveredSends, type SendLog, type SendRecord } from "./providers/outbox.ts"
import type { AbandonedCartData, CartLine } from "./templates/abandoned-cart.ts"

export type Step = 1 | 2 | 3

export type StepWindow = {
  step: Step
  /** Send no earlier than this long after the cart was last touched. */
  afterMs: number
  /** **And no later than this.** Past it the step is missed, not fired late. */
  untilMs: number
}

const HOUR = 3600_000

/**
 * The journey's shape. **Config, not constants** — these change with a marketing decision and
 * must be editable without a deploy, the same reasoning that put the 10-14 day backorder
 * promise in content.
 *
 * The upper bounds are generous relative to the job's cadence so an ordinary late run still
 * delivers, and tight enough that a lapsed weekend does not.
 */
export const DEFAULT_WINDOWS: StepWindow[] = [
  { step: 1, afterMs: 1 * HOUR, untilMs: 6 * HOUR },
  { step: 2, afterMs: 24 * HOUR, untilMs: 30 * HOUR },
  { step: 3, afterMs: 72 * HOUR, untilMs: 80 * HOUR },
]

export type CartCandidate = {
  id: string
  email?: string | null
  currency_code?: string
  customer_name?: string
  updated_at?: string | Date
  completed_at?: string | Date | null
  items?: Array<{ title?: unknown; quantity?: unknown; unit_price?: unknown
    variant_title?: unknown; thumbnail?: unknown }>
}

export type Decision =
  /** Send it. `subject_id` is what the send log is deduped on. */
  | { action: "send"; cart_id: string; step: Step; subject_id: string }
  /** Its window has passed. Not a failure, but it is counted and reported. */
  | { action: "missed"; cart_id: string; step: Step }
  /** Already delivered. */
  | { action: "already-sent"; cart_id: string; step: Step }
  /** **We cannot prove it has not already gone out. Never sends.** */
  | { action: "hold"; cart_id: string; step: Step; reason: string }

export type Plan = {
  decisions: Decision[]
  /** Every cart dropped before any step was considered, by reason. Always reported. */
  excluded: Record<string, number>
  /** How many carts were looked at. */
  scanned: number
  /** Human-readable coverage statement, or why there is none. */
  coverage: string
}

/** The send-log key for one step of one cart. Stable, and unique per step. */
export function subjectId(cartId: string, step: Step): string {
  return `${cartId}:step${step}`
}

function ms(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v === "string") {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  return null
}

/**
 * Decide what to send, for a batch of candidate carts.
 *
 * **The log is inspected once, before any cart is considered**, because an unusable log
 * disqualifies the entire run rather than each cart individually — and saying so once is
 * clearer than repeating it a thousand times.
 */
export function planJourney(
  carts: CartCandidate[],
  log: SendLog,
  now: number,
  windows: StepWindow[] = DEFAULT_WINDOWS
): Plan {
  const excluded: Record<string, number> = {}
  const bump = (k: string) => { excluded[k] = (excluded[k] ?? 0) + 1 }

  // ── the log, once ───────────────────────────────────────────────────────────────────────
  let sent: Set<string> | null = null
  let coverageFrom: number | null = null
  let holdAll: string | null = null

  if (log.state === "missing") {
    holdAll = `no send log (${log.detail}) — cannot prove these carts have not already been ` +
      `emailed, and a duplicate costs more than a miss`
  } else if (log.state === "unreadable") {
    holdAll = `send log unreadable (${log.detail}) — refusing to send rather than risk repeats`
  } else if (log.malformed > 0) {
    // The record proving we already sent may be in the part that would not parse.
    holdAll = `${log.malformed} unparseable line(s) in the send log — a previous send may be ` +
      `among them, so nothing can be sent without risking a repeat`
  } else {
    const stamps = coverageStamps(log.records)
    if (stamps.length === 0) {
      holdAll = "send log is present but holds no usable records — indistinguishable from one " +
        "just rotated, so a previous send cannot be ruled out"
    } else {
      coverageFrom = Math.min(...stamps)
      sent = new Set(
        deliveredSends(log.records)
          .filter((r): r is SendRecord & { subject_id: string } => Boolean(r.subject_id))
          .map((r) => r.subject_id)
      )
    }
  }

  const coverage = holdAll
    ? `NO COVERAGE — ${holdAll}`
    : `send log covers from ${new Date(coverageFrom!).toISOString()}`

  const decisions: Decision[] = []

  for (const cart of carts) {
    // ── reasons a cart is not a candidate at all ─────────────────────────────────────────
    if (cart.completed_at) { bump("recovered — the cart became an order"); continue }
    if (!cart.email?.trim()) { bump("no email address on the cart"); continue }
    if (!cart.items?.length) { bump("cart has no items"); continue }

    const touched = ms(cart.updated_at)
    if (touched === null) { bump("unusable updated_at — cannot place it in any window"); continue }

    const age = now - touched
    if (age < 0) {
      // A cart touched in the future is a clock problem, and clock problems are how a journey
      // fires everything at once. Refuse rather than treat it as freshly abandoned.
      bump("updated_at is in the future — clock skew, not an abandoned cart")
      continue
    }

    for (const w of windows) {
      if (age < w.afterMs) continue // not yet; it will come round again
      if (age >= w.untilMs) {
        decisions.push({ action: "missed", cart_id: cart.id, step: w.step })
        continue
      }

      const id = subjectId(cart.id, w.step)

      if (holdAll) {
        decisions.push({ action: "hold", cart_id: cart.id, step: w.step, reason: holdAll })
        continue
      }
      // **A cart last touched before the log begins may have its send record rotated away.**
      // Same blind spot the reconciliation reports; here it must stop a send, not a finding.
      if (touched < coverageFrom!) {
        decisions.push({ action: "hold", cart_id: cart.id, step: w.step,
          reason: `cart predates the send log (log starts ${new Date(coverageFrom!).toISOString()}) ` +
            `— an earlier send for it may have been rotated away` })
        continue
      }
      if (sent!.has(id)) {
        decisions.push({ action: "already-sent", cart_id: cart.id, step: w.step })
        continue
      }
      decisions.push({ action: "send", cart_id: cart.id, step: w.step, subject_id: id })
    }
  }

  return { decisions, excluded, scanned: carts.length, coverage }
}

/**
 * A cart -> the template's data.
 *
 * **The offer is passed in and is never invented.** The live SFCC series says *"Your Discount
 * Expires Soon"* on step 2 and step 3, and the code that used to back it — `CHECKOUT15` — has
 * had no redemption since 2026-06-05. Reproducing that faithfully would mean shipping a
 * rebuild that promises a discount nothing honours. `offer` absent means the template refuses
 * to promise one, which is the whole point of the seam.
 *
 * Money is minor units here, converted from Medusa's decimals by `toMinorUnits` at the caller,
 * for the same reason it is everywhere else in this module.
 */
export function buildCartData(
  cart: CartCandidate,
  step: Step,
  opts: { cartUrl: string; offer?: { percent: number; code?: string }
    toMinor: (v: unknown) => number | null }
): { ok: true; value: AbandonedCartData } | { ok: false; reason: string } {
  const currency = cart.currency_code?.trim()
  if (!currency) return { ok: false, reason: "cart has no currency_code" }
  if (!opts.cartUrl?.trim()) return { ok: false, reason: "no cart url — nothing to return to" }

  const items: CartLine[] = []
  for (const [i, raw] of (cart.items ?? []).entries()) {
    const title = typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim() : null
    if (!title) return { ok: false, reason: `cart line ${i} has no title` }
    const qty = Number(raw?.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, reason: `cart line ${i} (${title}) has no usable quantity` }
    }
    const unit = opts.toMinor(raw?.unit_price)
    if (unit === null) {
      return { ok: false, reason: `cart line ${i} (${title}) has no readable unit_price` }
    }
    const options = typeof raw?.variant_title === "string" && raw.variant_title.trim()
      ? [raw.variant_title.trim()] : undefined
    items.push({ title, quantity: qty, unit_price: unit,
      ...(options ? { options } : {}),
      ...(typeof raw?.thumbnail === "string" ? { thumbnail: raw.thumbnail } : {}) })
  }
  if (!items.length) return { ok: false, reason: "cart has no items" }

  return {
    ok: true,
    value: {
      items, currency_code: currency, cart_url: opts.cartUrl, step,
      ...(cart.customer_name?.trim() ? { customer_name: cart.customer_name.trim() } : {}),
      ...(opts.offer ? { offer: opts.offer } : {}),
    },
  }
}

/** One line summarising a run, for the job log. Counts every outcome, hides nothing. */
export function summarisePlan(plan: Plan): string {
  const by: Record<string, number> = {}
  for (const d of plan.decisions) by[d.action] = (by[d.action] ?? 0) + 1
  const parts = ["send", "already-sent", "missed", "hold"]
    .map((k) => `${k}=${by[k] ?? 0}`).join(" ")
  const dropped = Object.entries(plan.excluded)
    .map(([k, v]) => `${v} ${k}`).join("; ") || "none"
  return `scanned=${plan.scanned} ${parts} | excluded: ${dropped} | ${plan.coverage}`
}
