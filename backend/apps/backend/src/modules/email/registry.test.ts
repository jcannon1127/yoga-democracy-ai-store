import { test } from "node:test"
import assert from "node:assert/strict"
import { render, knownTemplates, UnknownTemplateError } from "./registry.ts"

const addr = { first_name: "H", last_name: "C", address_1: "1 St", city: "Orlando",
  province: "FL", postal_code: "32819" }
const order = {
  display_id: 1, created_at: "2026-08-23T14:00:00Z", customer_name: "Jane", currency_code: "usd",
  items: [{ title: "Bell", quantity: 1, unit_price: 5700, backordered: false }],
  subtotal: 5700, shipping_total: 0, tax_total: 0, total: 5700,
  shipping_address: addr, status_url: "https://x/account/orders/1",
}

test("all six templates are registered", () => {
  assert.deepEqual(knownTemplates().sort(),
    ["abandoned-cart", "gift-certificate", "order-confirmation", "password-reset",
     "shipment-notice", "welcome"])
})

test("a gift certificate that cannot be sent SKIPS with the reason named precisely", () => {
  const g = { recipient_email: "r@x.co", sender_name: "Jane", amount: 5000,
    currency_code: "usd", code: "GC-ABC", shop_url: "https://x/" }
  assert.equal(render("gift-certificate", g as never).outcome, "send")
  for (const [field, val, why] of [["code", "", /no code/], ["amount", 0, /no usable amount/],
    ["sender_name", "", /no sender name/], ["recipient_email", "", /no recipient/]] as const) {
    const r = render("gift-certificate", { ...g, [field]: val } as never)
    assert.equal(r.outcome, "skip", `${field} empty should not send`)
    assert.match((r as { reason: string }).reason, why as RegExp)
  }
})

test("abandoned cart renders per step, and skips with a reason when it cannot", () => {
  const cart = { items: [{ title: "Bell", quantity: 1, unit_price: 5700 }],
    currency_code: "usd", cart_url: "https://x/cart", step: 2 }
  assert.equal(render("abandoned-cart", cart as never).outcome, "send")
  const empty = render("abandoned-cart", { ...cart, items: [] } as never)
  assert.equal(empty.outcome, "skip")
  assert.match((empty as { reason: string }).reason, /empty/)
  const noUrl = render("abandoned-cart", { ...cart, cart_url: "" } as never)
  assert.match((noUrl as { reason: string }).reason, /cart url/)
})

test("an unknown template THROWS — never silently sends nothing", () => {
  assert.throws(() => render("order-confirmatoin", {}), UnknownTemplateError)
  assert.throws(() => render("", {}), UnknownTemplateError)
})

test("order confirmation renders and carries its subject", () => {
  const r = render("order-confirmation", order as never)
  assert.equal(r.outcome, "send")
  assert.match((r as { subject: string }).subject, /order #1/)
})

test("welcome with no code SKIPS with a reason — not send, not throw", () => {
  const r = render("welcome", { code: "", percent: 15, shop_url: "https://x/" })
  assert.equal(r.outcome, "skip")
  assert.match((r as { reason: string }).reason, /cannot be redeemed|code/)
  const good = render("welcome", { code: "welcome-A-B", percent: 15, shop_url: "https://x/" })
  assert.equal(good.outcome, "send")
})

test("a voided shipment SKIPS, and says so", () => {
  const base = { display_id: 1, customer_name: "H", tracking_number: "1Z", tracking_url: "https://x",
    items: [{ title: "Bell", quantity: 1 }] }
  const r = render("shipment-notice", { ...base, voided: true })
  assert.equal(r.outcome, "skip")
  assert.match((r as { reason: string }).reason, /voided/)
  assert.equal(render("shipment-notice", base).outcome, "send")
})

test("password reset with no URL SKIPS rather than promising help that cannot arrive", () => {
  const r = render("password-reset", { reset_url: "", email: "a@b.c", token_expires_minutes: 15 })
  assert.equal(r.outcome, "skip")
  assert.equal(render("password-reset",
    { reset_url: "https://x/r?token=t", email: "a@b.c", token_expires_minutes: 15 }).outcome, "send")
})

test("skip and send are never confusable", () => {
  const skipped = render("welcome", { code: "", percent: 15, shop_url: "x" })
  assert.ok(!("html" in skipped), "a skip must not carry html a caller could send")
})
