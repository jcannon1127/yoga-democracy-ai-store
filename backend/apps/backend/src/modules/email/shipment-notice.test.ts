/**
 * Tests for the shipment notice. The three-state `remaining_items` contract is the important
 * one: telling a customer their order is complete when it is not is the exact silent failure
 * this lane exists to prevent.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderShipmentNotice, shouldSend, subject, preheader } from "./templates/shipment-notice.ts"

const base = {
  display_id: 10428, customer_name: "Jane Sample",
  tracking_number: "9434650206217091004106",
  tracking_url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9434650206217091004106",
  carrier: "USPS Ground Advantage",
  items: [{ title: "Original Bell - Mint To Be", options: ["Size: L"], quantity: 1 }],
}
const html = (o: Record<string, unknown> = {}) => renderShipmentNotice({ ...base, ...o } as never)!

test("a VOIDED label never notifies — 25 voided labels in the last 180 days, 3 in August", () => {
  assert.equal(shouldSend({ voided: true, tracking_number: "x" }), false)
  assert.equal(renderShipmentNotice({ ...base, voided: true } as never), null)
})

test("no tracking number means no notice", () => {
  assert.equal(renderShipmentNotice({ ...base, tracking_number: "" } as never), null)
  assert.equal(renderShipmentNotice({ ...base, tracking_number: "  " } as never), null)
})

test("renders ONLY this parcel's items, never the order's", () => {
  const h = html({ items: [{ title: "In The Box", quantity: 1 }],
                   remaining_items: [{ title: "Not In The Box", quantity: 1 }] })
  const parcelBlock = h.slice(h.indexOf("In this parcel"), h.indexOf("Still to come"))
  assert.ok(parcelBlock.includes("In The Box"))
  assert.ok(!parcelBlock.includes("Not In The Box"),
    "an item that is not in this parcel appeared in the parcel table")
})

test("remaining_items has THREE states and undefined says neither", () => {
  const complete = html({ remaining_items: [] })
  assert.match(complete, /That is everything/)

  const partial = html({ remaining_items: [{ title: "Later Item", quantity: 2 }] })
  assert.match(partial, /Still to come/)
  assert.match(partial, /Later Item/)

  // The one that matters: not determined must claim NOTHING either way.
  const unknown = html({})
  assert.ok(!/That is everything/.test(unknown), "claimed the order was complete without knowing")
  assert.ok(!/Still to come/.test(unknown), "claimed more was coming without knowing")
})

test("subject names the parcel when the total is known", () => {
  assert.match(subject({ display_id: 1, parcel: { index: 1, total: 2 } }), /Parcel 1 of 2/)
  assert.match(subject({ display_id: 1, parcel: { index: 2, total: 3 } }), /Parcel 2 of 3/)
})

test("subject NEVER invents a total it does not have", () => {
  // "1 of 1" that turns out to be 1 of 2 is worse than saying nothing.
  const noTotal = subject({ display_id: 1, parcel: { index: 1 } })
  assert.ok(!/of \d/.test(noTotal), `invented a parcel total: ${noTotal}`)
  const later = subject({ display_id: 1, parcel: { index: 2 } })
  assert.match(later, /Another parcel/)
  assert.ok(!/of \d/.test(later))
  assert.ok(!/of \d/.test(subject({ display_id: 1 })))
})

test("preheader carries the order number and no contents", () => {
  const p = preheader({ display_id: 10428 })
  assert.match(p, /10428/)
  assert.ok(!/Mint To Be/.test(p))
  const m = html().match(/<div style="display:none[^"]*">([\s\S]*?)<\/div>/)
  assert.ok(m && !/Mint To Be/.test(m[1]), "preheader leaks order contents")
})

test("the tracking number and its link are both present and intact", () => {
  const h = html()
  assert.ok(h.includes(base.tracking_number))
  assert.ok(h.includes(base.tracking_url.replace(/&/g, "&amp;")) || h.includes(base.tracking_url))
})

test("customer data is escaped", () => {
  const h = html({ customer_name: "<script>alert(1)</script>" })
  assert.ok(!h.includes("<script>"))
})

// ── parity with the incumbent, checked against the real ShipStation emails ─────────────────

test("SHIPPED-TO IS RENDERED — the incumbent has it and it is how a customer catches a wrong address", () => {
  const h = renderShipmentNotice({ ...base, shipped_to: { name: "Jane Sample",
    address_1: "412 Oak St", address_2: "Apt 4047", city: "Indianapolis", province: "IN",
    postal_code: "46203" }, shipped_at: "2026-08-25T18:00:00Z" })!
  assert.match(h, /Shipped to/)
  assert.match(h, /412 Oak St/)
  assert.match(h, /Apt 4047/)
  assert.match(h, /Indianapolis, IN 46203/)
  assert.match(h, /August 25/)
})

test("A PARTIAL ADDRESS RENDERS NOTHING — a missing line is indistinguishable from a wrong one", () => {
  for (const a of [{ name: "Jane Sample" }, { city: "Indianapolis", province: "IN" },
    { address_1: "412 Oak St" }, {}]) {
    const h = renderShipmentNotice({ ...base, shipped_to: a })!
    assert.doesNotMatch(h, /Shipped to/, JSON.stringify(a))
  }
})

test("no address but a real ship date still tells the customer when it left", () => {
  const h = renderShipmentNotice({ ...base, shipped_at: "2026-08-25T18:00:00Z" })!
  assert.match(h, /Shipped August 25\./)
})

test("an unusable ship date says nothing rather than inventing a day", () => {
  for (const v of ["not a date", "", "2026-13-45"]) {
    const h = renderShipmentNotice({ ...base, shipped_at: v })!
    assert.doesNotMatch(h, /Shipped/, JSON.stringify(v))
  }
})

test("THE CARRIER IS NEVER INVENTED — YD has already shipped USPS on orders that paid for FedEx", () => {
  const { carrier: _drop, ...noCarrier } = base
  const h = renderShipmentNotice(noCarrier as never)!
  assert.match(h, /Tracking number/, "with no carrier known, the label is generic")
  // Visible text only: the tracking URL legitimately points at usps.com, and an href is not
  // a claim to the reader. What must not appear is a carrier NAME the customer would read.
  const visible = h.replace(/<[^>]+>/g, " ")
  assert.doesNotMatch(visible, /USPS|FedEx|UPS\b/i)
  assert.match(renderShipmentNotice({ ...base, carrier: "USPS Ground Advantage" })!,
    /USPS Ground Advantage/)
})

test("the address is shown BEFORE the parcel contents — tracking, then where, then what", () => {
  const h = renderShipmentNotice({ ...base, shipped_to: { name: "Jane Sample",
    address_1: "412 Oak St", city: "Indianapolis", province: "IN", postal_code: "46203" } })!
  assert.ok(h.indexOf("Shipped to") < h.indexOf("In this parcel"))
})

// ── what the void guard really covers, pinned so the claim cannot drift again ──────────────

test("the void guard stops a fulfillment ALREADY cancelled when the notice is built", () => {
  assert.equal(shouldSend({ voided: true, tracking_number: "1Z999" }), false)
  assert.equal(renderShipmentNotice({ ...base, voided: true }), null)
})

test("IT DOES NOT STOP A LABEL VOIDED AFTER THE SEND, AND THAT IS THE CASE THAT HAPPENS", () => {
  // The uncomfortable half, asserted rather than left implied. At send time canceled_at is
  // null, so the notice goes out; the void arrives later and nothing revisits it. Measured:
  // 21 of 25 real voids landed more than a minute after label creation, median 17 minutes.
  const atSendTime = { ...base, voided: undefined }
  assert.equal(shouldSend(atSendTime), true)
  assert.ok(renderShipmentNotice(atSendTime), "the email is already gone by the time it voids")
})

test("undefined is not false — an undetermined void state must not read as 'safe to send' by accident", () => {
  // It DOES send, but only because tracking exists; the distinction matters if a caller ever
  // starts passing an unknown state expecting it to be treated as a refusal.
  assert.equal(shouldSend({ voided: undefined, tracking_number: "" }), false)
  assert.equal(shouldSend({ voided: undefined, tracking_number: "1Z999" }), true)
})
