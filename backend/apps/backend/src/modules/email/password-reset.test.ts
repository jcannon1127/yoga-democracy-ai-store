/**
 * Tests for the password reset email. Negative control on every check, same rule as the
 * confirmation: a check that has never been shown to fail is not a check.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderPasswordReset, subject, preheader } from "./templates/password-reset.ts"
import {
  resetUrlRenderedVerbatim, preheaderCarriesNoSecret, expiryStated,
  statesNoActionIfUnrequested, resetUrlIsTheHref, noBlankQuantity,
  runResetChecks, summarise, type ResetCheckInput,
} from "./checks.ts"

const URL = "https://yd.thisisus.ai/account/reset-password?token=bfe186d17ed77241f1ca768886391&email=jane%40example.com"
const data = { reset_url: URL, email: "jane@realmail.co", token_expires_minutes: 15 }
const input = (over: Partial<ResetCheckInput["data"]> = {}): ResetCheckInput => {
  const d = { ...data, ...over }
  return { html: renderPasswordReset(d), subject: subject(), data: d }
}

test("reset_url appears verbatim, and the check FAILS when it does not", () => {
  assert.equal(resetUrlRenderedVerbatim(input()).verdict, "pass")
  const i = input()
  assert.equal(resetUrlRenderedVerbatim({ ...i, html: "<a href='/elsewhere'>x</a>" }).verdict, "fail")
})

test("preheader carries no token, URL or email — and the check FAILS if it does", () => {
  assert.equal(preheaderCarriesNoSecret(input()).verdict, "pass")
  const i = input()
  const leaky = i.html.replace(
    /<div style="display:none[^"]*">[\s\S]*?<\/div>/,
    `<div style="display:none;">${URL}</div>`)
  assert.equal(preheaderCarriesNoSecret({ ...i, html: leaky }).verdict, "fail")
  const emailLeak = i.html.replace(
    /<div style="display:none[^"]*">[\s\S]*?<\/div>/,
    `<div style="display:none;">jane@realmail.co</div>`)
  assert.equal(preheaderCarriesNoSecret({ ...i, html: emailLeak }).verdict, "fail")
})

test("preheader is not empty and says something useful", () => {
  assert.ok(preheader().length > 20)
  assert.ok(!preheader().includes("token"))
})

test("expiry is stated when known and UNDETERMINED when not — never invented", () => {
  assert.equal(expiryStated(input()).verdict, "pass")
  const none = input({ token_expires_minutes: undefined })
  assert.equal(expiryStated(none).verdict, "undetermined")
  // and the email must not have made a number up...
  assert.ok(!/\d+\s*minutes/.test(none.html), "an expiry was invented when none was supplied")
  // ...nor rendered the unit with the number missing, which is what forcing the block on does.
  assert.equal(noBlankQuantity(none).verdict, "pass",
    "no-expiry render must not leave a bare \"minutes\"")
})

test("tells a customer who did not request it to do nothing, and FAILS without that", () => {
  assert.equal(statesNoActionIfUnrequested(input()).verdict, "pass")
  const i = input()
  assert.equal(statesNoActionIfUnrequested({ ...i, html: "<p>reset it</p>" }).verdict, "fail")
})

test("subject is not the sender string", () => {
  assert.ok(!subject().includes("@"))
  assert.ok(!/<[^>]+>/.test(subject()))
})

test("a URL with HTML-special characters survives escaping intact", () => {
  const tricky = "https://yd.thisisus.ai/account/reset-password?token=a&b=c&email=x%40y.com"
  const i = input({ reset_url: tricky })
  assert.equal(resetUrlRenderedVerbatim(i).verdict, "pass")
  assert.ok(!i.html.includes('href="' + tricky + '"'), "raw & should be escaped inside href")
})

test("full reset run is clean on good data", () => {
  const s = summarise(runResetChecks(input()))
  assert.equal(s.fail, 0)
  assert.equal(s.undetermined, 0)
})

test("the reset URL is the actual href, not just present in the text", () => {
  assert.equal(resetUrlIsTheHref(input()).verdict, "pass")
  const i = input()
  // Negative control: visible text right, href mangled — the mutation that slipped through.
  const mangled = i.html.replace(/href="[^"]*reset-password[^"]*"/g, 'href="https://example.com/wrong"')
  assert.equal(resetUrlIsTheHref({ ...i, html: mangled }).verdict, "fail")
})

test("never renders a unit with no number", () => {
  assert.equal(noBlankQuantity(input()).verdict, "pass")
  const i = input()
  const blank = i.html.replace(/<strong>15 minutes<\/strong>/, "<strong></strong> minutes")
  assert.equal(noBlankQuantity({ ...i, html: blank }).verdict, "fail")
})
