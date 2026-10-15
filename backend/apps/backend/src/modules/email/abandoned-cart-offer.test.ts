import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOffer } from "./abandoned-cart-offer.ts"

test("no configuration means no offer, and the emails promise nothing", () => {
  const r = resolveOffer({})
  assert.equal(r.state, "none")
  assert.match(r.detail, /no offer configured/)
})

test("A PERCENT WITH NO CODE IS REFUSED unless someone declares it link-borne", () => {
  const r = resolveOffer({ ABANDONED_CART_OFFER_PERCENT: "15" })
  assert.equal(r.state, "none",
    "a forgotten code and a link-borne discount look identical; only one is intended")
  assert.match(r.detail, /ABANDONED_CART_OFFER_LINK_BORNE=true/)
})

test("declared link-borne, a percent alone is an offer with no code", () => {
  const r = resolveOffer({ ABANDONED_CART_OFFER_PERCENT: "15",
    ABANDONED_CART_OFFER_LINK_BORNE: "true" })
  assert.equal(r.state, "offer")
  assert.deepEqual((r as { offer: unknown }).offer, { percent: 15 })
})

test("percent and code together is the ordinary case, and it still says it is unproven", () => {
  const r = resolveOffer({ ABANDONED_CART_OFFER_PERCENT: "15",
    ABANDONED_CART_OFFER_CODE: "COMEBACK15" })
  assert.equal(r.state, "offer")
  assert.deepEqual((r as { offer: unknown }).offer, { percent: 15, code: "COMEBACK15" })
  assert.match(r.detail, /CHECKOUT15 looked exactly like this/)
})

test("a code with no percent promises nothing — an offer of unknown size cannot be described", () => {
  const r = resolveOffer({ ABANDONED_CART_OFFER_CODE: "COMEBACK15" })
  assert.equal(r.state, "none")
  assert.match(r.detail, /no percent/)
})

test("NONSENSE PERCENTAGES PROMISE NOTHING rather than promising nonsense", () => {
  for (const v of ["0", "-5", "100", "150", "abc", "", "  "]) {
    const r = resolveOffer({ ABANDONED_CART_OFFER_PERCENT: v,
      ABANDONED_CART_OFFER_CODE: "X" })
    assert.equal(r.state, "none", `${JSON.stringify(v)} must not become an offer`)
  }
})

test("link-borne must be the exact string true — not merely present", () => {
  const r = resolveOffer({ ABANDONED_CART_OFFER_PERCENT: "15",
    ABANDONED_CART_OFFER_LINK_BORNE: "false" })
  assert.equal(r.state, "none", 'the string "false" must not enable it')
})
