import { test } from "node:test"
import assert from "node:assert/strict"
import { planJourney, buildCartData, subjectId, summarisePlan, DEFAULT_WINDOWS,
  type CartCandidate } from "./abandoned-cart-journey.ts"
import { toMinorUnits } from "./medusa-map.ts"
import { classifyRecipient } from "./providers/delivery.ts"
import type { SendLog, SendRecord } from "./providers/outbox.ts"
import { renderAbandonedCart } from "./templates/abandoned-cart.ts"

const HOUR = 3600_000
const NOW = Date.parse("2026-08-25T12:00:00Z")
const ago = (h: number) => new Date(NOW - h * HOUR).toISOString()

const cart = (over: Partial<CartCandidate> = {}): CartCandidate => ({
  id: "cart_1", email: "jane@realmail.co", currency_code: "usd", updated_at: ago(2),
  items: [{ title: "Bell Bottoms", quantity: 1, unit_price: 88, variant_title: "L" }],
  ...over,
})

/** An `ok` log whose coverage starts well before anything under test. */
const logOf = (records: Partial<SendRecord>[] = []): SendLog => ({
  state: "ok", malformed: 0,
  records: [{ at: ago(500), template: "abandoned-cart", to: "x@x", action: "preview" },
    ...records].map((r) => r as SendRecord),
})

// ── the window ─────────────────────────────────────────────────────────────────────────────

test("a cart two hours old is in step 1's window", () => {
  const p = planJourney([cart()], logOf(), NOW)
  assert.deepEqual(p.decisions,
    [{ action: "send", cart_id: "cart_1", step: 1, subject_id: "cart_1:step1" }])
})

test("a cart 20 minutes old is not yet anything — silently, because it comes round again", () => {
  const p = planJourney([cart({ updated_at: ago(0.3) })], logOf(), NOW)
  assert.deepEqual(p.decisions, [])
  assert.deepEqual(p.excluded, {}, "not-yet is not an exclusion")
})

test("THE CATCH-UP STORM: a weekend-old cart is MISSED, never fired late", () => {
  // 50h: past step 1 (6h) and step 2 (30h), before step 3 (72h).
  const p = planJourney([cart({ updated_at: ago(50) })], logOf(), NOW)
  assert.deepEqual(p.decisions, [
    { action: "missed", cart_id: "cart_1", step: 1 },
    { action: "missed", cart_id: "cart_1", step: 2 },
  ])
  assert.equal(p.decisions.some((d) => d.action === "send"), false,
    '"You left something behind!" about a cart from three days ago')
})

test("a job that lapses for a week fires NOTHING, and says so", () => {
  const p = planJourney([cart({ updated_at: ago(24 * 7) })], logOf(), NOW)
  assert.deepEqual(p.decisions.map((d) => d.action), ["missed", "missed", "missed"])
})

test("each step is independent — a missed step 1 does not block step 2", () => {
  const p = planJourney([cart({ updated_at: ago(26) })], logOf(), NOW)
  assert.deepEqual(p.decisions, [
    { action: "missed", cart_id: "cart_1", step: 1 },
    { action: "send", cart_id: "cart_1", step: 2, subject_id: "cart_1:step2" },
  ])
})

test("the window boundaries are inclusive at the start and exclusive at the end", () => {
  const w = DEFAULT_WINDOWS[0]
  const at = (offset: number) => planJourney(
    [cart({ updated_at: new Date(NOW - w.afterMs - offset).toISOString() })], logOf(), NOW)
  assert.equal(at(0).decisions[0]?.action, "send", "exactly at the lower bound sends")
  assert.equal(at(-1).decisions.length, 0, "one ms before is not yet")
  const end = planJourney(
    [cart({ updated_at: new Date(NOW - w.untilMs).toISOString() })], logOf(), NOW)
  assert.equal(end.decisions[0]?.action, "missed", "exactly at the upper bound is missed")
})

// ── the duplicate, and the reversed polarity ───────────────────────────────────────────────

test("an already-delivered step is not sent again", () => {
  const p = planJourney([cart()], logOf([
    { at: ago(1), template: "abandoned-cart", to: "jane@realmail.co", action: "send",
      subject_id: "cart_1:step1" }]), NOW)
  assert.deepEqual(p.decisions, [{ action: "already-sent", cart_id: "cart_1", step: 1 }])
})

test("A PREVIEW IS NOT A SEND, so it does not suppress the real one", () => {
  const p = planJourney([cart()], logOf([
    { at: ago(1), template: "abandoned-cart", to: "jane@realmail.co", action: "preview",
      subject_id: "cart_1:step1" }]), NOW)
  assert.equal(p.decisions[0].action, "send")
})

test("NO SEND LOG MEANS HOLD, NOT SEND — the opposite of every other decision in this lane", () => {
  const p = planJourney([cart()], { state: "missing", detail: "no file" }, NOW)
  assert.equal(p.decisions[0].action, "hold")
  assert.match((p.decisions[0] as { reason: string }).reason, /duplicate costs more than a miss/)
})

test("an unreadable log, a malformed line, and an empty log all hold", () => {
  const cases: SendLog[] = [
    { state: "unreadable", detail: "EACCES" },
    { state: "ok", malformed: 1, records: [
      { at: ago(500), template: "abandoned-cart", to: "x@x", action: "send" } as SendRecord] },
    { state: "ok", malformed: 0, records: [] },
  ]
  for (const log of cases) {
    const p = planJourney([cart()], log, NOW)
    assert.equal(p.decisions[0].action, "hold", JSON.stringify(log.state))
    assert.match(p.coverage, /NO COVERAGE/)
  }
})

test("A CART OLDER THAN THE LOG HOLDS — its send record may have been rotated away", () => {
  const log: SendLog = { state: "ok", malformed: 0, records: [
    { at: ago(1), template: "abandoned-cart", to: "x@x", action: "send" } as SendRecord] }
  const p = planJourney([cart({ updated_at: ago(2) })], log, NOW)
  assert.equal(p.decisions[0].action, "hold")
  assert.match((p.decisions[0] as { reason: string }).reason, /predates the send log/)
})

test("a hold is never a send, in any shape", () => {
  for (const log of [{ state: "missing", detail: "x" } as SendLog,
    { state: "unreadable", detail: "x" } as SendLog]) {
    const p = planJourney([cart(), cart({ id: "cart_2" })], log, NOW)
    assert.equal(p.decisions.every((d) => d.action === "hold"), true)
  }
})

// ── who is not a candidate at all, and the counting of them ────────────────────────────────

test("a recovered cart is dropped — it became an order", () => {
  const p = planJourney([cart({ completed_at: ago(1) })], logOf(), NOW)
  assert.deepEqual(p.decisions, [])
  assert.deepEqual(p.excluded, { "recovered — the cart became an order": 1 })
})

test("EVERY EXCLUSION IS COUNTED — a journey that mails nobody must not look idle", () => {
  const p = planJourney([
    cart({ id: "a", completed_at: ago(1) }),
    cart({ id: "b", email: "" }),
    cart({ id: "c", email: null }),
    cart({ id: "d", items: [] }),
    cart({ id: "e", updated_at: "not a date" }),
    cart({ id: "f", updated_at: new Date(NOW + HOUR).toISOString() }),
  ], logOf(), NOW)

  assert.deepEqual(p.decisions, [])
  assert.equal(p.scanned, 6)
  assert.deepEqual(p.excluded, {
    "recovered — the cart became an order": 1,
    "no email address on the cart": 2,
    "cart has no items": 1,
    "unusable updated_at — cannot place it in any window": 1,
    "updated_at is in the future — clock skew, not an abandoned cart": 1,
  })
  assert.match(summarisePlan(p), /send=0 .*excluded: .*no email address on the cart/)
})

test("a clock running backwards does not look like a fresh abandonment", () => {
  const p = planJourney([cart({ updated_at: new Date(NOW + 5 * HOUR).toISOString() })],
    logOf(), NOW)
  assert.equal(p.decisions.length, 0)
  assert.match(Object.keys(p.excluded).join(), /clock skew/)
})

test("the summary states coverage, so a clean run is never a bare pass", () => {
  assert.match(summarisePlan(planJourney([cart()], logOf(), NOW)), /send log covers from/)
  assert.match(summarisePlan(planJourney([cart()], { state: "missing", detail: "x" }, NOW)),
    /NO COVERAGE/)
})

test("subject ids are unique per step, so one send cannot satisfy another", () => {
  assert.notEqual(subjectId("cart_1", 1), subjectId("cart_1", 2))
  assert.equal(subjectId("cart_1", 3), "cart_1:step3")
})

// ── the data the template gets ─────────────────────────────────────────────────────────────

test("cart data converts Medusa decimals and renders the real price", () => {
  const r = buildCartData(cart(), 1, { cartUrl: "https://x/cart/cart_1", toMinor: toMinorUnits })
  assert.ok(r.ok)
  assert.equal(r.value.items[0].unit_price, 8800)
  assert.match(renderAbandonedCart(r.value)!, /\$88\.00/)
})

test("NO OFFER IS INVENTED — and with none, no step promises a discount", () => {
  for (const step of [1, 2, 3] as const) {
    const r = buildCartData(cart(), step, { cartUrl: "https://x/c", toMinor: toMinorUnits })
    assert.ok(r.ok)
    assert.equal(r.value.offer, undefined)
    const html = renderAbandonedCart(r.value)!
    assert.doesNotMatch(html, /\d+% off/i, `step ${step} promised a discount with no offer`)
  }
})

test("an offer passed in is carried through", () => {
  const r = buildCartData(cart(), 2, { cartUrl: "https://x/c", toMinor: toMinorUnits,
    offer: { percent: 15, code: "COMEBACK15" } })
  assert.ok(r.ok)
  assert.match(renderAbandonedCart(r.value)!, /COMEBACK15/)
})

test("an unreadable cart price refuses rather than showing a wrong number", () => {
  const bad = cart({ items: [{ title: "Bell Bottoms", quantity: 1, unit_price: "n/a" }] })
  const r = buildCartData(bad, 1, { cartUrl: "https://x/c", toMinor: toMinorUnits })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /Bell Bottoms.*unit_price/)
})

test("no cart url refuses — an abandoned-cart email with nowhere to go is pointless", () => {
  const r = buildCartData(cart(), 1, { cartUrl: "", toMinor: toMinorUnits })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /no cart url/)
})

test("THE FIXTURE'S OWN ADDRESS MUST BE SENDABLE — a test address the system would refuse is a test pulling toward the bug", () => {
  // This journey dispatches to `cart.email`. The fixture was `jane@example.com`, which
  // classifyRecipient refuses — so every plan here was built around an address that could
  // never have received the email, and nothing failed, because these tests stop short of the
  // send. yd-accounts named the pattern: the placeholder domain colonises the test data.
  assert.equal(classifyRecipient(cart().email!).state, "usable")
})
