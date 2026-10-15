import { test } from "node:test"
import assert from "node:assert/strict"
import { reconcileSends } from "./reconcile.ts"

const T0 = Date.parse("2026-08-24T12:00:00Z")
const NOW = T0 + 60 * 60 * 1000
const order = (id: string, at = T0) => ({ id, created_at: new Date(at).toISOString() })
const send = (id: string, template = "order-confirmation") => ({ order_id: id, template })

test("ZERO ORDERS IS UNDETERMINED, NOT PASS — the 0-in/0-out signature of a broken query", () => {
  const r = reconcileSends([], [], "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "undetermined")
  assert.notEqual(r.verdict, "pass")
  assert.match(r.detail, /nothing is proven/)
})

test("an unavailable order list or send log is undetermined, not clean", () => {
  assert.equal(reconcileSends(null as never, [], "t", { now: NOW }).verdict, "undetermined")
  assert.equal(reconcileSends([order("a")], null as never, "t", { now: NOW }).verdict, "undetermined")
})

test("catches the whole silent class: orders exist, no sends at all", () => {
  // Wrong event name, dead subscriber, dead transport — all look like this.
  const r = reconcileSends([order("a"), order("b")], [], "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "fail")
  assert.deepEqual(r.missing, ["a", "b"])
})

test("catches a partial gap and names the orders", () => {
  const r = reconcileSends([order("a"), order("b"), order("c")],
    [send("a"), send("c")], "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "fail")
  assert.deepEqual(r.missing, ["b"])
  assert.match(r.detail, /\bb\b/)
})

test("passes only when every eligible order has a send", () => {
  const r = reconcileSends([order("a"), order("b")], [send("a"), send("b")],
    "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "pass")
  assert.equal(r.checked, 2)
})

test("a send for a DIFFERENT template does not count", () => {
  const r = reconcileSends([order("a")], [send("a", "welcome")], "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "fail")
})

test("orders inside the grace window are not judged, and that is undetermined not pass", () => {
  const fresh = order("a", NOW - 60 * 1000) // one minute old
  const r = reconcileSends([fresh], [], "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "undetermined")
  assert.match(r.detail, /grace window/)
})

test("an unparseable timestamp is excluded rather than silently treated as eligible", () => {
  const r = reconcileSends([{ id: "a", created_at: "not-a-date" }], [], "order-confirmation",
    { now: NOW })
  assert.equal(r.verdict, "undetermined")
})

import { reconcileFromLog, crossCheckUndeliverable } from "./reconcile.ts"
import type { SendLog } from "./providers/outbox.ts"

const sendRec = (order_id: string, action = "send") => ({
  at: "2026-08-24T12:00:00Z", template: "order-confirmation", to: "a@b.co", order_id, action })

test("A MISSING SEND LOG IS UNDETERMINED — not every order failing, not everything fine", () => {
  const log: SendLog = { state: "missing", detail: "no send log at /x" }
  const r = reconcileFromLog([order("a"), order("b")], log, "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "undetermined")
  assert.deepEqual(r.missing, [], "invented a catastrophe from a missing file")
})

test("an unreadable log is undetermined", () => {
  const log: SendLog = { state: "unreadable", detail: "EACCES" }
  assert.equal(reconcileFromLog([order("a")], log, "order-confirmation", { now: NOW }).verdict,
    "undetermined")
})

test("ANY malformed line forces undetermined — the missing record may be in it", () => {
  const log: SendLog = { state: "ok", records: [sendRec("a")] as never, malformed: 1 }
  const r = reconcileFromLog([order("a"), order("b")], log, "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "undetermined")
  assert.match(r.detail, /unparseable/)
})

test("a clean log reconciles normally, and previews do not count as sends", () => {
  const clean: SendLog = { state: "ok", malformed: 0,
    records: [sendRec("a"), sendRec("b", "preview")] as never }
  const r = reconcileFromLog([order("a"), order("b")], clean, "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "fail")
  assert.deepEqual(r.missing, ["b"], "a preview file was counted as an email")
})

test("a fully clean log with real sends passes", () => {
  const clean: SendLog = { state: "ok", malformed: 0,
    records: [sendRec("a"), sendRec("b")] as never }
  assert.equal(reconcileFromLog([order("a"), order("b")], clean, "order-confirmation",
    { now: NOW }).verdict, "pass")
})

test("DETECTION POWER: orders predating the log cannot be judged, and that is not a pass", () => {
  const old = order("old", T0 - 48 * 60 * 60 * 1000)   // two days before the log starts
  const recent = order("recent", T0)
  const log: SendLog = { state: "ok", malformed: 0,
    records: [sendRec("recent")] as never }
  const r = reconcileFromLog([old, recent], log, "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "undetermined", "reported clean while blind to an older order")
  assert.deepEqual(r.uncovered, ["old"])
  assert.match(r.detail, /predate the log/)
})

test("a real failure inside coverage is STILL a failure, with the blind spot reported", () => {
  const old = order("old", T0 - 48 * 60 * 60 * 1000)
  const log: SendLog = { state: "ok", malformed: 0, records: [sendRec("a")] as never }
  const r = reconcileFromLog([old, order("a"), order("b")], log, "order-confirmation",
    { now: NOW })
  assert.equal(r.verdict, "fail", "a genuine missing send was downgraded by a blind spot")
  assert.deepEqual(r.missing, ["b"])
  assert.deepEqual(r.uncovered, ["old"])
})

test("coverage comes from ALL records — a preview line proves the logger was running", () => {
  // No delivered sends at all, but the logger was demonstrably alive across the window.
  const log: SendLog = { state: "ok", malformed: 0,
    records: [sendRec("x", "preview")] as never }
  const r = reconcileFromLog([order("a")], log, "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "fail", "logger was running and this order got nothing")
  assert.deepEqual(r.missing, ["a"])
  assert.deepEqual(r.uncovered, [])
})

test("a present log with no usable records is undetermined, not 'nothing was sent'", () => {
  const log: SendLog = { state: "ok", malformed: 0, records: [] }
  const r = reconcileFromLog([order("a")], log, "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "undetermined")
  assert.match(r.detail, /rotated/)
})

test("every clean result states its coverage window — a bare 'pass' is not allowed", () => {
  const log: SendLog = { state: "ok", malformed: 0,
    records: [sendRec("a"), sendRec("b")] as never }
  const r = reconcileFromLog([order("a"), order("b")], log, "order-confirmation", { now: NOW })
  assert.equal(r.verdict, "pass")
  assert.match(r.detail, /log covers from/, "a pass with no stated coverage is not a pass")
  assert.match(r.detail, /all orders covered/)
})

// ── the cross-check with yd-accounts ───────────────────────────────────────────────────────

test("A MATCHING ZERO IS NOT AGREEMENT WHEN THIS SIDE HAS NEVER RUN", () => {
  const r = crossCheckUndeliverable({ theirs: 0, ours: 0, attempted: 0 })
  assert.equal(r.state, "not_yet_comparable")
  assert.match(r.detail, /not agreement/)
})

test("A NULL COUNT IS UNREADABLE, NEVER ZERO — a renamed jq key returns null", () => {
  for (const theirs of [null, undefined, "541", NaN, -1, {}]) {
    const r = crossCheckUndeliverable({ theirs, ours: 0, attempted: 10 })
    assert.equal(r.state, "unreadable", JSON.stringify(theirs))
  }
  // and the null must not sneak through as a match against our own zero
  const r = crossCheckUndeliverable({ theirs: null, ours: 0, attempted: 10 })
  assert.notEqual(r.state, "agree")
})

test("real agreement is only reported once this side has actually attempted deliveries", () => {
  const r = crossCheckUndeliverable({ theirs: 541, ours: 541, attempted: 1200 })
  assert.equal(r.state, "agree")
  assert.equal((r as { count: number }).count, 541)
})

test("a genuine disagreement names both numbers and points at the shared cases", () => {
  const r = crossCheckUndeliverable({ theirs: 541, ours: 538, attempted: 1200 })
  assert.equal(r.state, "disagree")
  assert.match(r.detail, /reserved-address-cases\.json/)
  assert.match(r.detail, /the detector working/)
})

test("our own count being unreadable is caught too, not just theirs", () => {
  assert.equal(crossCheckUndeliverable({ theirs: 541, ours: null, attempted: 10 }).state, "unreadable")
  assert.equal(crossCheckUndeliverable({ theirs: 541, ours: 5, attempted: null }).state, "unreadable")
})
