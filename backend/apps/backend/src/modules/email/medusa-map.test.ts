import { test } from "node:test"
import assert from "node:assert/strict"
import { toMinorUnits, mapOrderToConfirmation, mapFulfillmentToShipmentNotice } from "./medusa-map.ts"
import { renderOrderConfirmation } from "./templates/order-confirmation.ts"

const addr = { first_name: "Jane", last_name: "S", address_1: "1 St", city: "Orlando",
  province: "FL", postal_code: "32819" }

/** A Medusa 2 order: DECIMAL amounts, not cents. */
const order = {
  id: "order_1", display_id: 1042, created_at: "2026-08-25T14:00:00Z", currency_code: "usd",
  shipping_address: addr,
  items: [
    { id: "li_1", title: "Bell Bottoms", variant_title: "L", quantity: 1, unit_price: 88 },
    { id: "li_2", title: "Ready or Knot Tank", variant_title: "M", quantity: 2, unit_price: 19.99 },
  ],
  item_subtotal: 127.98, shipping_total: 0, tax_total: 8.96, total: 136.94,
}

// ── the 100x error ─────────────────────────────────────────────────────────────────────────

test("MEDUSA 2 AMOUNTS ARE DECIMAL: 88 means $88.00, and reaches the template as 8800", () => {
  const r = mapOrderToConfirmation(order)
  assert.ok(r.ok)
  assert.equal(r.value.items[0].unit_price, 8800)
  assert.equal(r.value.total, 13694)
  // The proof that matters is the rendered document, not the number.
  const html = renderOrderConfirmation(r.value)
  assert.match(html, /\$88\.00/)
  assert.match(html, /\$136\.94/)
  assert.doesNotMatch(html, /\$8,800\.00/, "cents-as-dollars would print $8,800.00")
  assert.doesNotMatch(html, /\$0\.88/, "dollars-as-cents would print $0.88")
})

test("$19.99 SURVIVES THE FLOAT: 19.99*100 is 1998.9999999999998, and truncation loses a penny", () => {
  assert.equal(toMinorUnits(19.99), 1999)
  assert.equal(toMinorUnits("19.99"), 1999)
  assert.notEqual(Math.trunc(19.99 * 100), 1999) // the mistake this guards against, stated
})

test("every shape a BigNumberValue actually arrives in maps identically", () => {
  const bn = { valueOf: () => 57 } // a live BigNumber: nothing but a numeric valueOf
  for (const v of [57, "57", "57.00", { value: "57.00" }, { value: 57 }, { numeric: 57 }, bn]) {
    assert.equal(toMinorUnits(v), 5700, JSON.stringify(v))
  }
})

test("A DATE IN A MONEY FIELD IS REFUSED — Number(new Date()) is epoch ms, about $17bn", () => {
  const d = new Date("2026-08-25T00:00:00Z")
  assert.ok(Number(d) > 1e12, "this is the number that would have been rendered")
  assert.equal(toMinorUnits(d), null)
  const r = mapOrderToConfirmation({ ...order, total: d })
  assert.equal(r.ok, false)
})

test("an object that only stringifies to a number is not money", () => {
  assert.equal(toMinorUnits({ toString: () => "57" }), null)
})

test("A MISSING AMOUNT IS null, NEVER 0 — '$0.00' tells a customer their order was free", () => {
  for (const v of [undefined, null, NaN, Infinity, "", "  ", "abc", "57abc", "$57", {}, [], true]) {
    assert.equal(toMinorUnits(v), null, `${JSON.stringify(v)} must not become a number`)
  }
})

// ── refusals ───────────────────────────────────────────────────────────────────────────────

test("an order with no readable total refuses rather than confirming $0.00", () => {
  const r = mapOrderToConfirmation({ ...order, total: undefined })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /no readable total/)
})

test("no currency refuses — the same number is $57 or £57", () => {
  const r = mapOrderToConfirmation({ ...order, currency_code: "" })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /currency/)
})

test("an unreadable price on ONE line fails the whole email, and names the line", () => {
  const bad = { ...order, items: [order.items[0], { ...order.items[1], unit_price: "n/a" }] }
  const r = mapOrderToConfirmation(bad)
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /Ready or Knot Tank.*unit_price/)
})

test("a present-but-unreadable tax total refuses; an absent one is simply absent", () => {
  assert.equal(mapOrderToConfirmation({ ...order, tax_total: "??" }).ok, false)
  const r = mapOrderToConfirmation({ ...order, tax_total: undefined })
  assert.ok(r.ok)
  assert.equal(r.value.tax_total, 0)
})

test("no shipping address, no display_id, no items and no created_at each refuse separately", () => {
  for (const [field, reason] of [["shipping_address", /shipping address/],
    ["display_id", /display_id/], ["items", /no line items/], ["created_at", /created_at/]] as const) {
    const r = mapOrderToConfirmation({ ...order, [field]: undefined })
    assert.equal(r.ok, false, field)
    assert.match((r as { reason: string }).reason, reason)
  }
})

test("BACKORDERED IS LEFT UNDETERMINED, NOT false — a false 'ships now' is the failure we exist to prevent", () => {
  const r = mapOrderToConfirmation(order)
  assert.ok(r.ok)
  for (const l of r.value.items) {
    assert.equal(l.backordered, undefined,
      "the mapper must not assert in-stock; Medusa's order line does not know")
    assert.equal("backordered" in l, false)
  }
})

test("a missing customer name falls back to a real greeting and SAYS it did", () => {
  const r = mapOrderToConfirmation({ ...order,
    shipping_address: { address_1: "1 St", city: "Orlando", province: "FL", postal_code: "32819" } })
  assert.ok(r.ok)
  assert.equal(r.value.customer_name, "there")
  assert.match(r.notes.join(" "), /greeting falls back/)
})

test("a clean order maps with no notes at all", () => {
  const r = mapOrderToConfirmation(order, { statusUrl: "https://x/account/orders/1042" })
  assert.ok(r.ok)
  assert.deepEqual(r.notes, [])
  assert.equal(r.value.status_url, "https://x/account/orders/1042")
})

// ── shipment notice ────────────────────────────────────────────────────────────────────────

const ful = {
  id: "ful_1",
  labels: [{ tracking_number: "1Z999", tracking_url: "https://ups/1Z999" }],
  items: [{ title: "Bell Bottoms", quantity: 1, line_item_id: "li_1" }],
}

test("A FULFILLMENT ITEM HAS NO PRICE — the order mapper would have refused every shipment", () => {
  const r = mapFulfillmentToShipmentNotice(ful, order)
  assert.ok(r.ok, (r as { reason?: string }).reason)
  assert.deepEqual(r.value.items, [{ title: "Bell Bottoms", quantity: 1 }])
  assert.equal(r.value.tracking_number, "1Z999")
})

test("shipment.created carries no order id, so a missing order refuses and says why", () => {
  const r = mapFulfillmentToShipmentNotice(ful, null)
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /carries no order id/)
})

test("a cancelled fulfillment is a voided label, which the template refuses to send", () => {
  const r = mapFulfillmentToShipmentNotice({ ...ful, canceled_at: "2026-08-25T00:00:00Z" }, order)
  assert.ok(r.ok)
  assert.equal(r.value.voided, true)
})

test("EXTRA LABELS ARE NAMED, NOT DROPPED — a second parcel's tracking must not vanish silently", () => {
  const two = { ...ful, labels: [...ful.labels,
    { tracking_number: "1Z888", tracking_url: "https://ups/1Z888" }] }
  const r = mapFulfillmentToShipmentNotice(two, order)
  assert.ok(r.ok)
  assert.equal(r.value.tracking_number, "1Z999")
  assert.match(r.notes.join(" "), /NOT SENT TO THE CUSTOMER: 1Z888/)
})

test("REMAINING_ITEMS IS UNDEFINED UNLESS ASKED FOR — '[]' would say the order is complete", () => {
  const r = mapFulfillmentToShipmentNotice(ful, order)
  assert.ok(r.ok)
  assert.equal(r.value.remaining_items, undefined)
  assert.equal("remaining_items" in r.value, false)
})

test("with every fulfillment supplied, remaining is the unshipped balance", () => {
  const r = mapFulfillmentToShipmentNotice(ful, order, { allFulfillments: [ful] })
  assert.ok(r.ok)
  assert.deepEqual(r.value.remaining_items, [{ title: "Ready or Knot Tank", quantity: 2 }])
})

test("a fully shipped order reports an empty remainder, which is a real answer", () => {
  const rest = { id: "ful_2", labels: [{ tracking_number: "1Z777", tracking_url: "u" }],
    items: [{ title: "Ready or Knot Tank", quantity: 2, line_item_id: "li_2" }] }
  const r = mapFulfillmentToShipmentNotice(rest, order, { allFulfillments: [ful, rest] })
  assert.ok(r.ok)
  assert.deepEqual(r.value.remaining_items, [])
})

test("AN UNJOINABLE SHIPPED ITEM MAKES REMAINING UNDETERMINED, NOT WRONG", () => {
  const noLink = { ...ful, items: [{ title: "Bell Bottoms", quantity: 1 }] } // no line_item_id
  const r = mapFulfillmentToShipmentNotice(noLink, order, { allFulfillments: [noLink] })
  assert.ok(r.ok)
  assert.equal(r.value.remaining_items, undefined,
    "matching on title would have subtracted the wrong line on a two-size order")
  assert.match(r.notes.join(" "), /undetermined rather than guessed/)
})

test("a cancelled fulfillment does not count as having shipped anything", () => {
  const voided = { id: "ful_x", canceled_at: "2026-08-25T00:00:00Z",
    items: [{ title: "Ready or Knot Tank", quantity: 2, line_item_id: "li_2" }] }
  const r = mapFulfillmentToShipmentNotice(ful, order, { allFulfillments: [ful, voided] })
  assert.ok(r.ok)
  assert.deepEqual(r.value.remaining_items, [{ title: "Ready or Knot Tank", quantity: 2 }])
})
