import { test } from "node:test"
import assert from "node:assert/strict"
import { render, knownTemplates } from "./registry.ts"
import { noPlaceholderLeakage } from "./checks.ts"

/**
 * WHAT A PERSON ACTUALLY RECEIVES, for EVERY template — not just the machinery that produced it.
 *
 * **`noPlaceholderLeakage` already existed and only one template of six was ever swept with
 * it.** That is yd-store's finding in this lane: *the preview was dead for days and `:8000`
 * returned 200 to every health check the whole time.* **Every check watched a component;
 * nothing watched the surface a human meets.** A template that compiles, registers, renders and
 * reconciles can still put `undefined`, `NaN`, `[object Object]` or a raw `${` in front of a
 * customer, and every structural check in this lane would pass.
 *
 * **This is driven off `knownTemplates()` on purpose.** A hand-written list is how five
 * templates went unswept in the first place — a new one would simply not be added to it. Here a
 * template with no fixture FAILS, so it cannot be added without being checked.
 */
const addr = { first_name: "Jane", last_name: "Sample", address_1: "412 Oak St",
  city: "Indianapolis", province: "IN", postal_code: "46203" }

/** Realistic data per template. A missing entry is a failure, not a skip. */
const FIXTURES: Record<string, Record<string, unknown>> = {
  "order-confirmation": {
    display_id: 10432, created_at: "2026-08-26T14:00:00Z", customer_name: "Jane Sample",
    currency_code: "usd",
    items: [{ title: "Bell Bottoms", options: ["Size: L"], quantity: 2, unit_price: 8800 }],
    subtotal: 17600, shipping_total: 0, tax_total: 1232, total: 18832, shipping_address: addr,
    status_url: "https://yogademocracy.com/account/orders/1",
  },
  "shipment-notice": {
    display_id: 10432, customer_name: "Jane Sample", tracking_number: "9400150206217747219241",
    tracking_url: "https://tools.usps.com/x", carrier: "USPS Ground Advantage",
    items: [{ title: "Bell Bottoms", options: ["Size: L"], quantity: 2 }],
    shipped_to: { name: "Jane Sample", address_1: "412 Oak St", city: "Indianapolis",
      province: "IN", postal_code: "46203" },
    shipped_at: "2026-08-26T18:00:00Z", remaining_items: [],
  },
  "password-reset": { reset_url: "https://yogademocracy.com/account/reset?token=abc",
    email: "jane@realmail.co", token_expires_minutes: 15 },
  welcome: { code: "WELCOME15", percent: 15, shop_url: "https://yogademocracy.com/" },
  "abandoned-cart": {
    customer_name: "Jane", currency_code: "usd", step: 3,
    items: [{ title: "Bell Bottoms", options: ["Size: L"], quantity: 1, unit_price: 8800 }],
    cart_url: "https://yogademocracy.com/cart?cart_id=c1",
    offer: { percent: 15, code: "COMEBACK15", expires_at: "2026-09-01" },
  },
  "gift-certificate": {
    recipient_email: "friend@realmail.co", sender_name: "Jane", amount: 5000,
    currency_code: "usd", code: "GC-ABCD-EFGH", shop_url: "https://yogademocracy.com/",
    message: "Happy birthday", expires_at: "2027-01-15",
  },
}

test("EVERY registered template has a fixture — a new one cannot escape this sweep", () => {
  const missing = knownTemplates().filter((t) => !(t in FIXTURES))
  assert.deepEqual(missing, [],
    "add a fixture for these; a hand-written list is how five templates went unswept")
})

test("NO TEMPLATE PUTS undefined / NaN / [object Object] / ${ IN FRONT OF A CUSTOMER", () => {
  for (const id of knownTemplates()) {
    const r = render(id, FIXTURES[id])
    assert.equal(r.outcome, "send", `${id} refused its own realistic fixture`)
    const { html, subject } = r as { html: string; subject: string }
    const f = noPlaceholderLeakage({ html, subject, backorder: { state: "absent" } })
    assert.equal(f.verdict, "pass", `${id}: ${f.detail ?? ""}`)
    assert.ok(html.length > 500, `${id} rendered suspiciously little (${html.length} bytes)`)
    assert.ok(subject.trim().length > 0, `${id} has an empty subject`)
  }
})

test("THE SWEEP CAN FAIL — a leaked value in the BODY is caught", () => {
  const f = noPlaceholderLeakage({ html: "<p>Total: [object Object]</p>", subject: "Your order",
    backorder: { state: "absent" } })
  assert.equal(f.verdict, "fail")
})

test("AND IN THE SUBJECT, which is what a customer reads before opening", () => {
  // The subject was accepted by this check and never inspected until 2026-08-26. YD's live
  // order confirmation has shipped for months with its From header leaking into the Subject.
  for (const bad of ["Your order undefined has shipped", "Save NaN% today",
    "Order ${order.display_id}", "Hi [object Object]"]) {
    const f = noPlaceholderLeakage({ html: "<p>fine</p>", subject: bad,
      backorder: { state: "absent" } })
    assert.equal(f.verdict, "fail", bad)
    assert.match(f.detail!, /SUBJECT LINE/)
  }
})

test("a clean subject and body pass together", () => {
  assert.equal(noPlaceholderLeakage({ html: "<p>fine</p>", subject: "Your order #10432",
    backorder: { state: "absent" } }).verdict, "pass")
})

/**
 * MINIMAL data: only what each template strictly requires, every optional field absent.
 *
 * **This is where `undefined` actually appears.** The sweep above renders realistic fixtures
 * with every field populated — which is the happy path, and a leak check that only ever sees
 * the happy path is the same mistake one level up from the one it exists to catch. A real order
 * with no discount, no second address, no message and no expiry is the common case, not the
 * exotic one.
 *
 * **It was clean when added, so its value is preventing a regression rather than fixing a live
 * bug** — stated plainly, because a check whose worth is future-only should say so instead of
 * being presented as a catch.
 */
const SPARSE: Record<string, Record<string, unknown>> = {
  "order-confirmation": { display_id: 1, created_at: "2026-08-26T14:00:00Z", customer_name: "H",
    currency_code: "usd", items: [{ title: "X", quantity: 1, unit_price: 100 }],
    subtotal: 100, shipping_total: 0, tax_total: 0, total: 100,
    shipping_address: { address_1: "1 St", city: "Indy", province: "IN", postal_code: "46203" } },
  "shipment-notice": { display_id: 1, customer_name: "H", tracking_number: "1Z",
    tracking_url: "https://x/1Z", items: [{ title: "X", quantity: 1 }] },
  "password-reset": { reset_url: "https://x/r" },
  welcome: { code: "W15", percent: 15, shop_url: "https://x/" },
  "abandoned-cart": { currency_code: "usd", step: 1, cart_url: "https://x/c",
    items: [{ title: "X", quantity: 1, unit_price: 100 }] },
  "gift-certificate": { recipient_email: "r@realmail.co", sender_name: "H", amount: 100,
    currency_code: "usd", code: "GC-1", shop_url: "https://x/" },
}

test("every template has a SPARSE fixture too — the optional-field case cannot be skipped", () => {
  assert.deepEqual(knownTemplates().filter((t) => !(t in SPARSE)), [])
})

test("NO TEMPLATE LEAKS ON SPARSE DATA — every optional field absent, which is the common order", () => {
  for (const id of knownTemplates()) {
    const r = render(id, SPARSE[id])
    assert.equal(r.outcome, "send", `${id} refused a minimal-but-valid order`)
    const { html, subject } = r as { html: string; subject: string }
    const f = noPlaceholderLeakage({ html, subject, backorder: { state: "absent" } })
    assert.equal(f.verdict, "pass", `${id} on sparse data: ${f.detail ?? ""}`)
  }
})

test("the sparse fixtures are NOT just the full ones again — they exercise different output", () => {
  // Otherwise the pass above is vacuous: two identical inputs checked twice prove one thing once.
  let differed = 0
  for (const id of knownTemplates()) {
    const a = render(id, FIXTURES[id]) as { html: string }
    const b = render(id, SPARSE[id]) as { html: string }
    if (a.html !== b.html) differed++
  }
  assert.equal(differed, knownTemplates().length,
    "a template rendered identically from full and sparse data — one fixture is not doing its job")
})
