/**
 * Tests for the welcome email. Negative control on every check.
 *
 * The distinctive rule here: **no code means DO NOT SEND.** Unlike the backorder note, where a
 * missing value leaves a correct email slightly less informative, the code *is* this email. A
 * welcome message promising a discount that does not work makes a customer's first experience
 * of YD being refused at checkout.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderWelcome, subject, preheader } from "./templates/welcome.ts"
import { welcomePercentMatchesPromotion, runWelcomeChecks, summarise } from "./checks.ts"

const good = { code: "welcome-4AZZ-MMZS-HOP9-W4T3", percent: 15, shop_url: "https://yd.thisisus.ai/" }
const html = () => renderWelcome(good)!

test("no code means no email — null, not a broken send", () => {
  assert.equal(renderWelcome({ ...good, code: "" }), null)
  assert.equal(renderWelcome({ ...good, code: "   " }), null)
  assert.equal(renderWelcome({ ...good, code: undefined as unknown as string }), null)
})

test("an impossible percent means no email", () => {
  assert.equal(renderWelcome({ ...good, percent: 0 }), null)
  assert.equal(renderWelcome({ ...good, percent: -5 }), null)
  assert.equal(renderWelcome({ ...good, percent: NaN }), null)
})

test("the code appears verbatim and intact", () => {
  assert.ok(html().includes(good.code), "code missing from the rendered email")
})

test("the percent comes from data, never from the copy", () => {
  const twenty = renderWelcome({ ...good, percent: 20 })!
  assert.ok(twenty.includes("20%"), "percent not taken from data")
  assert.ok(!twenty.includes("15%"), "a hardcoded 15% survived into a 20% email")
  assert.ok(subject({ percent: 20 }).includes("20%"))
  assert.ok(preheader({ percent: 20 }).includes("20%"))
})

test("the preheader does NOT contain the code", () => {
  // Visible in list view and on lock screens; a discount code there is a code anyone can read.
  assert.ok(!preheader(good).includes(good.code))
  const m = html().match(/<div style="display:none[^"]*">([\s\S]*?)<\/div>/)
  assert.ok(m, "no preheader block")
  assert.ok(!m![1].includes(good.code), "preheader leaks the welcome code")
})

test("no placeholder leakage", () => {
  for (const t of ["undefined", "NaN", "[object Object]", "${"]) {
    assert.ok(!html().includes(t), `rendered output contains ${t}`)
  }
})

test("a code with HTML-special characters is escaped, not executed", () => {
  const evil = renderWelcome({ ...good, code: '<script>alert(1)</script>' })!
  assert.ok(!evil.includes("<script>"), "code was not escaped")
})

test("advertised percent must match the promotion record — and UNDETERMINED without one", () => {
  const base = { html: html(), subject: subject(good), data: good }
  assert.equal(welcomePercentMatchesPromotion({ ...base, promotion_percent: 15 }).verdict, "pass")
  // Negative control: the drift yd-promo's own gate cannot see.
  assert.equal(welcomePercentMatchesPromotion({ ...base, promotion_percent: 20 }).verdict, "fail")
  // No promotion supplied is NOT a pass.
  assert.equal(welcomePercentMatchesPromotion(base).verdict, "undetermined")
})

test("full welcome run is clean with a matching promotion", () => {
  const s = summarise(runWelcomeChecks({
    html: html(), subject: subject(good), data: good, promotion_percent: 15,
  }))
  assert.equal(s.fail, 0)
  assert.equal(s.undetermined, 0)
})
