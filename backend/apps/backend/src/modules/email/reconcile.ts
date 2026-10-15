/**
 * Did the emails that should have been sent actually get sent?
 *
 * **This exists because a subscriber wired to the wrong event name is silent by nature.**
 * Medusa 2.19 emits `order.placed`; I believe that is right and I am not willing to rely on
 * believing it, because if it is wrong the subscriber simply never fires — no error, no log,
 * no failed test. The same is true of a dead transport, a template that throws, or a
 * subscriber someone deletes during a refactor.
 *
 * **None of those are detectable by inspecting the sending code. All of them are detectable
 * by comparing orders against sends.** So this is the check that actually covers the class,
 * and the subscriber is not trusted on its own.
 *
 * **An empty order list is `undetermined`, never `pass`.** "No orders, therefore no missing
 * confirmations, therefore clean" is the shape that let a guard report 13/13 green while
 * inspecting nothing, and it is exactly how this detector would lie if the order query broke.
 */

import { deliveredSends, type SendLog, type SendRecord } from "./providers/outbox.ts"

export type OrderRef = { id: string; created_at: string | Date }
export type SendRef = { order_id: string; template: string }

export type Reconciliation = {
  verdict: "pass" | "fail" | "undetermined"
  checked: number
  missing: string[]
  /** Orders the log demonstrably does not cover — it starts after they were placed. Their
   *  records may simply have been rotated away, so they can never be called un-emailed. */
  uncovered?: string[]
  detail: string
}

export function reconcileSends(
  orders: OrderRef[],
  sends: SendRef[],
  template: string,
  /** Orders newer than this are excluded: a send may legitimately not have happened yet. */
  opts: { graceMs?: number; now?: number } = {}
): Reconciliation {
  const grace = opts.graceMs ?? 15 * 60 * 1000
  const now = opts.now ?? 0

  if (!Array.isArray(orders)) {
    return { verdict: "undetermined", checked: 0, missing: [],
      detail: "order list unavailable — cannot tell whether anything is missing" }
  }
  if (orders.length === 0) {
    // NOT a pass. Zero inputs and zero findings is the signature of a broken query.
    return { verdict: "undetermined", checked: 0, missing: [],
      detail: "no orders in the window — nothing was checked, so nothing is proven" }
  }
  if (!Array.isArray(sends)) {
    return { verdict: "undetermined", checked: 0, missing: [],
      detail: "send log unavailable — cannot tell whether anything is missing" }
  }

  const eligible = orders.filter((o) => {
    const t = o.created_at instanceof Date ? o.created_at.getTime() : Date.parse(String(o.created_at))
    return Number.isFinite(t) && (now === 0 || now - t >= grace)
  })
  if (eligible.length === 0) {
    return { verdict: "undetermined", checked: 0, missing: [],
      detail: `all ${orders.length} order(s) are inside the ${Math.round(grace / 60000)}m grace window` }
  }

  const sent = new Set(sends.filter((s) => s.template === template).map((s) => s.order_id))
  const missing = eligible.filter((o) => !sent.has(o.id)).map((o) => o.id)

  if (missing.length) {
    return { verdict: "fail", checked: eligible.length, missing,
      detail: `${missing.length} of ${eligible.length} order(s) have no ${template} send: ` +
        `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " …" : ""}` }
  }
  return { verdict: "pass", checked: eligible.length, missing: [],
    detail: `all ${eligible.length} order(s) have a ${template} send` }
}

/**
 * The timestamps a log's coverage window is computed from.
 *
 * **Every record, not just delivered sends.** A `preview`, `skip` or `failed` line still
 * proves the logger was running at that moment. Computing coverage from successful sends only
 * would make a window in which nothing was successfully sent look like a window nobody was
 * watching — turning the exact failure being hunted into a blind spot.
 *
 * Shared with the abandoned-cart journey, which needs the same window for the opposite
 * purpose: the reconciliation uses it to avoid inventing failures outside the log, the journey
 * uses it to avoid RE-SENDING outside the log. One rule, one implementation.
 */
export function coverageStamps(records: SendRecord[]): number[] {
  return records.map((r) => Date.parse(r.at)).filter((t) => Number.isFinite(t))
}

/**
 * Reconcile against a real send log rather than an array someone assembled.
 *
 * **A missing or unreadable log is `undetermined`, never `fail` and never `pass`.** Treating a
 * missing log as "no sends" would report every order as missing a confirmation — inventing a
 * catastrophe; treating it as "no problem" would hide one. **Neither is honest, and the file
 * not existing is the exact state the system is in before a transport is ever wired.**
 *
 * **Malformed lines force `undetermined` too.** A log we can only partly read cannot support a
 * claim that a specific order was never emailed — the record may be in the part we could not
 * parse.
 */
export function reconcileFromLog(
  orders: OrderRef[],
  log: SendLog,
  template: string,
  opts: { graceMs?: number; now?: number } = {}
): Reconciliation {
  if (log.state === "missing") {
    return { verdict: "undetermined", checked: 0, missing: [], detail: log.detail }
  }
  if (log.state === "unreadable") {
    return { verdict: "undetermined", checked: 0, missing: [],
      detail: `send log unreadable: ${log.detail}` }
  }
  if (log.malformed > 0) {
    return { verdict: "undetermined", checked: 0, missing: [],
      detail: `${log.malformed} unparseable line(s) in the send log — a missing record may be ` +
        `among them, so no order can be called un-emailed` }
  }
  /**
   * **Detection power, reported rather than assumed.**
   *
   * A log is a tail. If it begins after some orders were placed, those orders' records may
   * have been rotated away — so a "missing send" for them is not a finding, it is a blind
   * spot. **A check that reads a bounded slice and reports "clean" is indistinguishable from
   * one that did not look**, which is how a promotion guard reads 200 unpaginated rows and
   * misses the offender it exists to catch.
   *
   * Coverage is computed from **every** record, not just delivered ones: a `preview` or a
   * `skip` line still proves the logger was running at that moment.
   */
  const stamps = coverageStamps(log.records)
  if (stamps.length === 0) {
    return { verdict: "undetermined", checked: 0, missing: [],
      detail: "send log is present but holds no usable records — cannot tell whether nothing " +
        "was sent or the log was just rotated" }
  }
  const coverageFrom = Math.min(...stamps)

  const sends = deliveredSends(log.records)
    .filter((r) => r.order_id)
    .map((r) => ({ order_id: r.order_id as string, template: r.template }))
  const uncovered = orders
    .filter((o) => {
      const t = o.created_at instanceof Date ? o.created_at.getTime()
        : Date.parse(String(o.created_at))
      return Number.isFinite(t) && t < coverageFrom
    })
    .map((o) => o.id)

  const covered = orders.filter((o) => !uncovered.includes(o.id))
  const base = reconcileSends(covered, sends, template, opts)
  const window = `log covers from ${new Date(coverageFrom).toISOString()}`

  if (uncovered.length === 0) {
    return { ...base, uncovered: [], detail: `${base.detail} (${window}; all orders covered)` }
  }
  // Real failures inside the covered range are still findings; a clean covered range with
  // uncovered orders outside it is NOT a pass.
  const verdict = base.verdict === "fail" ? "fail" : "undetermined"
  return { ...base, verdict, uncovered,
    detail: `${base.detail} — but ${uncovered.length} order(s) predate the log and cannot be ` +
      `judged at all (${window})` }
}

export type SubjectRef = { id: string; order_id?: string; created_at: string | Date }

/**
 * Reconcile per SUBJECT rather than per order.
 *
 * **For anything an order can need more than one of.** A gift-certificate order with three
 * certificates needs three sends; joining on `order_id` would call it satisfied after one, and
 * two recipients would get nothing with no error anywhere. That is the multi-parcel mistake
 * wearing different clothes — and here each miss is a paid-for gift that never arrived.
 */
export function reconcileSubjects(
  subjects: SubjectRef[],
  log: SendLog,
  template: string,
  opts: { graceMs?: number; now?: number } = {}
): Reconciliation {
  // Reuse every guard in reconcileFromLog by presenting subjects as orders keyed on subject id,
  // and sends keyed on subject_id. Coverage, malformed lines and the missing-log rules all hold.
  const remapped: SendLog = log.state !== "ok" ? log : {
    state: "ok",
    malformed: log.malformed,
    records: log.records.map((r) => ({ ...r, order_id: r.subject_id })),
  }
  return reconcileFromLog(subjects.map((s) => ({ id: s.id, created_at: s.created_at })),
    remapped, template, opts)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Cross-checking the undeliverable count against yd-accounts
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Compare yd-accounts' count of unreachable imported customers against ours.
 *
 * **The whole value of two implementations is that they can disagree** — so this exists to
 * make sure a comparison that CANNOT disagree is never reported as agreement. Both failure
 * modes are real and both were found in one evening:
 *
 * 1. **A matching zero from a side that has never run.** Our `blocked` count is structurally
 *    zero until a transport exists, because nothing sends. Two instruments agreeing because
 *    neither has run is the vacuous pass this project keeps rediscovering.
 * 2. **A null read as a zero.** yd-accounts' figure is fetched as
 *    `.[] | select(.detector=="migrated_account_access") | .evidence.undeliverable_imported_customers`
 *    — three keys deep. **Rename any one of them and jq returns `null`, which JavaScript will
 *    happily treat as 0**, and 0 === 0 reads as agreement that never happened. It hit the
 *    KeyError version of this writing the reader against `name` instead of `detector`.
 *
 * So a missing or non-numeric count is `unreadable`, never zero; and no comparison is possible
 * at all until this side has actually attempted deliveries.
 */
export type UndeliverableCrossCheck =
  | { state: "agree"; count: number; detail: string }
  | { state: "disagree"; theirs: number; ours: number; detail: string }
  /** Neither side is wrong — ours simply has not run. NOT agreement. */
  | { state: "not_yet_comparable"; detail: string }
  /** A count could not be read. NOT zero. */
  | { state: "unreadable"; detail: string }

export function crossCheckUndeliverable(input: {
  /** yd-accounts' `undeliverable_imported_customers`. */
  theirs: unknown
  /** How many recipients we refused as unreachable. */
  ours: unknown
  /** How many deliveries this side has attempted at all. Zero means we have never run. */
  attempted: unknown
}): UndeliverableCrossCheck {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null

  const theirs = num(input.theirs)
  const ours = num(input.ours)
  const attempted = num(input.attempted)

  if (theirs === null) {
    return { state: "unreadable",
      detail: "yd-accounts' undeliverable_imported_customers is missing or not a number — " +
        "most likely a renamed key returning null from jq. A null is NOT zero, and 0 === 0 " +
        "would have read as agreement that never happened." }
  }
  if (ours === null || attempted === null) {
    return { state: "unreadable",
      detail: "our own blocked/attempted counts are missing or not numbers — cannot compare" }
  }
  if (attempted === 0) {
    return { state: "not_yet_comparable",
      detail: `this side has attempted 0 deliveries, so our count of ${ours} is structurally ` +
        `zero rather than measured. yd-accounts reports ${theirs}. **A matching zero here is ` +
        `not agreement** — it is two instruments neither of which has run.` }
  }
  if (theirs === ours) {
    return { state: "agree", count: ours,
      detail: `both instruments independently count ${ours} unreachable, over ${attempted} ` +
        `attempted deliveries` }
  }
  return { state: "disagree", theirs, ours,
    detail: `yd-accounts counts ${theirs} unreachable, we count ${ours} over ${attempted} ` +
      `attempted deliveries. One of the two rules has drifted from ` +
      `data/reserved-address-cases.json — that disagreement is the detector working.` }
}
