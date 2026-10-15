import { test } from "node:test"
import assert from "node:assert/strict"
import { WIRING, NOT_EVENT_DRIVEN, checkEventNames, checkTemplateCoverage, decideNotify,
  type MedusaEventConstants } from "./events.ts"
import { knownTemplates } from "./registry.ts"

/** The constants as actually exported by the installed @medusajs/utils 2.19.0. */
const REAL: MedusaEventConstants = {
  OrderWorkflowEvents: { PLACED: "order.placed", FULFILLMENT_CREATED: "order.fulfillment_created" },
  FulfillmentWorkflowEvents: { SHIPMENT_CREATED: "shipment.created",
    DELIVERY_CREATED: "delivery.created" },
  AuthWorkflowEvents: { PASSWORD_RESET: "auth.password_reset" },
}

test("the wired names match Medusa's own constants", () => {
  const r = checkEventNames(REAL, "test fixture")
  assert.equal(r.state, "ok")
})

test("A RENAMED EVENT IS A MISMATCH, NOT A PASS — this is the silence the check exists for", () => {
  const renamed = { ...REAL,
    FulfillmentWorkflowEvents: { ...REAL.FulfillmentWorkflowEvents, SHIPMENT_CREATED: "fulfillment.shipped" } }
  const r = checkEventNames(renamed, "test fixture")
  assert.equal(r.state, "mismatch")
  assert.match((r as { problems: string[] }).problems.join(" "), /fulfillment\.shipped/)
})

test("a removed key and a removed group both report, and name the template that dies with them", () => {
  const noKey = { ...REAL, OrderWorkflowEvents: { FULFILLMENT_CREATED: "order.fulfillment_created" } }
  const a = checkEventNames(noKey, "t")
  assert.equal(a.state, "mismatch")
  assert.match((a as { problems: string[] }).problems.join(" "), /order-confirmation will never send/)

  const noGroup = { ...REAL, AuthWorkflowEvents: undefined }
  const b = checkEventNames(noGroup, "t")
  assert.equal(b.state, "mismatch")
  assert.match((b as { problems: string[] }).problems.join(" "), /password-reset/)
})

test("UNREADABLE CONSTANTS ARE `undetermined`, NEVER `ok` — an unverifiable check is not a pass", () => {
  for (const bad of [undefined, null, "not an object", 7]) {
    const r = checkEventNames(bad as never, "no node_modules here")
    assert.equal(r.state, "undetermined", `${JSON.stringify(bad)} must not pass`)
    assert.match((r as { detail: string }).detail, /UNVERIFIED|not a pass/)
  }
})

test("every built template is either wired to an event or has an excuse on record", () => {
  const r = checkTemplateCoverage(knownTemplates())
  assert.deepEqual(r.problems, [])
  assert.equal(r.state, "ok")
})

test("a template nobody dispatches and nobody excused is a gap, not a quiet success", () => {
  const r = checkTemplateCoverage([...knownTemplates(), "return-received"])
  assert.equal(r.state, "gaps")
  assert.match(r.problems.join(" "), /return-received .*nothing dispatches/)
})

test("a wired template that the registry does not know is caught before render() throws in production", () => {
  const r = checkTemplateCoverage(knownTemplates().filter((t) => t !== "shipment-notice"))
  assert.equal(r.state, "gaps")
  assert.match(r.problems.join(" "), /shipment-notice is wired to an event but is not a known template/)
})

test("the wiring records where each event is emitted, so the next person re-checks instead of re-trusting", () => {
  for (const w of WIRING) {
    assert.ok(w.emittedBy.trim().length > 20, `${w.event} has no provenance`)
    assert.ok(w.payload.trim().length > 0, `${w.event} has no payload note`)
  }
})

test("shipment-notice is wired to shipment.created and NOT to order.fulfillment_created", () => {
  const w = WIRING.find((x) => x.template === "shipment-notice")!
  assert.equal(w.event, "shipment.created")
  // The point of the entry: fulfillment_created exists and fires, so wiring it is not inert —
  // it is a permanent stream of well-reasoned skips.
  assert.match(w.note!, /no tracking number/)
})

test("abandoned-cart and welcome are excused in writing rather than forgotten", () => {
  assert.ok(NOT_EVENT_DRIVEN["abandoned-cart"])
  assert.ok(NOT_EVENT_DRIVEN["welcome"])
})

// ── no_notification ────────────────────────────────────────────────────────────────────────

test("absent, null and false all mean notify — Medusa's default is no suppression", () => {
  for (const p of [{}, { no_notification: null }, { no_notification: false }, undefined, null]) {
    const d = decideNotify(p)
    assert.equal(d.state, "notify", JSON.stringify(p))
    assert.equal(d.notify, true)
  }
})

test("exactly true suppresses — an admin said no and we obey", () => {
  const d = decideNotify({ no_notification: true })
  assert.equal(d.state, "suppressed")
  assert.equal(d.notify, false)
})

test('THE STRING "false" MUST NOT SUPPRESS — `if (data.no_notification)` would silence every email', () => {
  const d = decideNotify({ no_notification: "false" })
  assert.equal(d.notify, true, 'the string "false" is truthy; a truthiness test suppresses here')
  assert.equal(d.state, "unclear")
  assert.match(d.detail!, /neither true nor false/)
})

test("an uninterpretable flag still sends, and still says so loudly", () => {
  for (const v of ["true", 1, 0, "", {}, []]) {
    const d = decideNotify({ no_notification: v })
    assert.equal(d.notify, true, `${JSON.stringify(v)} should still deliver`)
    assert.equal(d.state, "unclear")
    assert.ok(d.detail, "an unclear flag must not be silent")
  }
})
