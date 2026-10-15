/**
 * Tests for the abandoned-cart series.
 *
 * The load-bearing one: **no offer means no step may promise a discount.** The live step 2 and
 * step 3 copy is entirely about the 15%, and yd-promo has not yet settled whether the offer
 * rides on the link or needs a code. A template that hardcodes the discount would promise one
 * the checkout might not honour — on the email whose whole job is closing the sale.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderAbandonedCart, subject, preheader,
  type AbandonedCartData } from "./templates/abandoned-cart.ts"

const items = [
  { title: "Capri Legging - Art Deco", options: ["Size: M"], quantity: 1, unit_price: 8500 },
  { title: "Ready or Knot Tank - Flower Bomb", options: ["Size: L"], quantity: 2, unit_price: 6500 },
]
const base = { items, currency_code: "usd", cart_url: "https://yd.thisisus.ai/cart?id=abc" }
const d = (o: Partial<AbandonedCartData> = {}) => ({ ...base, step: 1, ...o } as AbandonedCartData)
const html = (o: Partial<AbandonedCartData> = {}) => renderAbandonedCart(d(o))!

test("NO OFFER MEANS NO STEP PROMISES A DISCOUNT", () => {
  for (const step of [1, 2, 3] as const) {
    const h = html({ step })
    assert.ok(!/%\s*off/i.test(h), `step ${step} promised a discount with no offer`)
    assert.ok(!/discount/i.test(subject({ step })), `step ${step} subject promised a discount`)
    assert.ok(!/discount/i.test(preheader({ step })), `step ${step} preheader promised a discount`)
  }
})

test("step 3 without an offer does not claim anything is expiring", () => {
  const h = html({ step: 3 })
  assert.ok(!/expir/i.test(h), "claimed an expiry with nothing to expire")
  assert.ok(!/expir/i.test(subject({ step: 3 })))
  assert.match(subject({ step: 3 }), /Last chance/)
})

test("with an offer, the percent comes from data and never from copy", () => {
  const twenty = html({ step: 2, offer: { percent: 20 } })
  assert.match(twenty, /20% off your cart/)
  assert.ok(!/15%/.test(twenty), "a hardcoded 15% survived into a 20% offer")
  assert.match(subject({ step: 2, offer: { percent: 20 } }), /20% off/)
  // No expiry configured, so step 3 must NOT claim one — see the expiry tests below.
  assert.match(subject({ step: 3, offer: { percent: 20 } }), /Last chance: 20% off/)
  assert.match(subject({ step: 3, offer: { percent: 20, expires_at: "2026-09-01" } }),
    /20% discount expires/)
})

test("NOTHING PROMISES AN EXPIRY UNLESS ONE IS CONFIGURED — YD is currently living the alternative", () => {
  const noExpiry = { step: 3 as const, offer: { percent: 15, code: "X" } }
  const h = html(noExpiry)
  assert.doesNotMatch(h, /expir/i, "step 3 claimed an expiry with nothing expiring")
  assert.doesNotMatch(subject(noExpiry), /expir/i)
  assert.doesNotMatch(preheader(noExpiry), /expir/i)
})

test("with a real expiry, step 3 says so AND names the date, so the claim is checkable", () => {
  const d = { step: 3 as const, offer: { percent: 15, code: "X", expires_at: "2026-09-01" } }
  assert.match(subject(d), /expires soon/)
  const h = html(d)
  assert.match(h, /Expiring soon/)
  assert.match(h, /Use it by September 1/)
})

test("AN UNPARSEABLE EXPIRY BEHAVES EXACTLY LIKE NO EXPIRY, never as a silent third state", () => {
  const bad = { step: 3 as const, offer: { percent: 15, code: "X", expires_at: "not a date" } }
  const none = { step: 3 as const, offer: { percent: 15, code: "X" } }
  assert.equal(subject(bad), subject(none))
  assert.equal(preheader(bad), preheader(none))
  assert.equal(html(bad), html(none))
})

test("THE EMAIL MAKES NO CLAIM ABOUT STOCK — nothing in this journey checks availability", () => {
  for (const step of [1, 2, 3] as const) {
    for (const offer of [undefined, { percent: 15 }]) {
      const h = html({ step, ...(offer ? { offer } : {}) })
      assert.doesNotMatch(h, /still in your size|in stock|still available/i,
        `step ${step} promised availability three days after the cart was abandoned`)
    }
  }
})

test("a code is shown when there is one, and 'applied automatically' when there is not", () => {
  const withCode = html({ step: 2, offer: { percent: 15, code: "SFwelcome15" } })
  assert.match(withCode, /SFwelcome15/)
  assert.ok(!/Applied automatically/.test(withCode))

  const linkBorne = html({ step: 2, offer: { percent: 15 } })
  assert.match(linkBorne, /Applied automatically at checkout/)
  // ...and must not invent a code
  assert.ok(!/[A-Z]{3,}\d+/.test(linkBorne.replace(/[^>]*>/g, " ")), "invented a code")
})

test("an empty cart or a missing cart link sends nothing", () => {
  assert.equal(renderAbandonedCart(d({ items: [] })), null)
  assert.equal(renderAbandonedCart(d({ items: undefined as never })), null)
  assert.equal(renderAbandonedCart(d({ cart_url: "" })), null)
  assert.equal(renderAbandonedCart(d({ cart_url: "   " })), null)
})

test("an out-of-range step sends nothing rather than guessing", () => {
  assert.equal(renderAbandonedCart(d({ step: 0 as never })), null)
  assert.equal(renderAbandonedCart(d({ step: 4 as never })), null)
})

test("the cart link is the button's href on every step", () => {
  for (const step of [1, 2, 3] as const) {
    const h = html({ step })
    const hrefs = [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
      .filter((x) => !x.startsWith("mailto:"))
    assert.ok(hrefs.length > 0, `step ${step} has no link at all`)
    assert.ok(hrefs.every((x) => x === base.cart_url),
      `step ${step} has a link that is not the cart url: ${hrefs.find((x) => x !== base.cart_url)}`)
  }
})

test("the cart's contents are shown, with real alt text and not a placeholder", () => {
  // The live SFMC emails render `Image placeholder` four times with images blocked.
  const h = html({ items: [{ ...items[0], thumbnail: "https://x/img.jpg" }] })
  assert.match(h, /alt="Capri Legging - Art Deco"/)
  assert.ok(!/Image placeholder/i.test(h))
})

test("multi-quantity lines are not ambiguous", () => {
  assert.match(html(), /2 &times; \$65\.00/)
})

test("the preheader never carries the cart contents", () => {
  for (const step of [1, 2, 3] as const) {
    assert.ok(!/Art Deco|Flower Bomb/.test(preheader({ step })))
    const m = html({ step }).match(/<div style="display:none[^"]*">([\s\S]*?)<\/div>/)
    assert.ok(m && !/Art Deco/.test(m[1]), `step ${step} preheader leaks cart contents`)
  }
})

test("works with no customer name — most abandoned carts are guests", () => {
  const h = html()
  assert.ok(!/undefined|Hey ,/.test(h))
  assert.match(html({ customer_name: "Jane" }), /Hey Jane,/)
})
