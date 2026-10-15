/**
 * Tests for the order confirmation email.
 *
 * **Every check gets a negative control.** A check that has never been shown to fail is not
 * a check — that is exactly how a guard goes 13/13 green while inspecting nothing. So each
 * case below asserts the good input passes AND that a deliberately broken input fails.
 *
 *   node --experimental-strip-types --test src/modules/email/order-confirmation.test.ts
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderOrderConfirmation, subject, backorderCopy } from "./templates/order-confirmation.ts"
import { writeFileSync, unlinkSync } from "node:fs"
import {
  subjectIsNotSenderString, backorderNoteMatchesLines, noUndeterminedBackorderLines,
  backorderCopyReadable, totalsAddUp, customerDataIsEscaped, noPlaceholderLeakage,
  hasOrderDateAndStatusLink, runChecks, summarise, type CheckInput,
} from "./checks.ts"

const addr = { first_name: "Jane", last_name: "Sample", address_1: "7600 Majorca Place",
  city: "Orlando", province: "FL", postal_code: "32819" }

function order(over: Record<string, unknown> = {}) {
  const items = [
    { title: "Original Bell - Mint To Be", options: ["Size: L"], quantity: 1, unit_price: 5700, backordered: false },
    { title: "Free Range Sports Bra", options: ["Size: 2XL"], quantity: 1, unit_price: 5300, backordered: true },
    { title: "YD Legging", options: ["Size: M"], quantity: 2, unit_price: 9000, backordered: false },
  ]
  return {
    display_id: 10428, created_at: "2026-08-23T14:12:00Z", customer_name: "Jane Sample",
    currency_code: "usd", items,
    subtotal: 29000, discount_total: 3600, shipping_total: 0, tax_total: 1780, total: 27180,
    shipping_address: addr, billing_address: addr,
    payment: { brand: "American Express", last4: "1006" },
    status_url: "https://www.yogademocracy.com/account/orders/10428",
    ...over,
  } as any
}

function input(o = order()): CheckInput {
  return { html: renderOrderConfirmation(o), subject: subject(o), order: o, backorder: backorderCopy() }
}

test("content is readable and carries the promise", () => {
  const c = backorderCopy()
  assert.equal(c.state, "ok", `backorder copy not readable: ${JSON.stringify(c)}`)
  assert.match((c as { message: string }).message, /10.14 days/)
})

test("subject: passes, and FAILS on the real SFCC bug", () => {
  assert.equal(subjectIsNotSenderString(input()).verdict, "pass")
  // Negative control: the literal live defect.
  const broken = { ...input(), subject: "Yoga Democracy <cs@yogademocracy.com>" }
  assert.equal(subjectIsNotSenderString(broken).verdict, "fail")
  assert.equal(subjectIsNotSenderString({ ...input(), subject: "" }).verdict, "fail")
})

test("backorder note: exactly the backordered lines, and FAILS when it is not", () => {
  assert.equal(backorderNoteMatchesLines(input()).verdict, "pass")

  // Negative control 1: note missing from the email entirely.
  const i = input()
  const stripped = { ...i, html: i.html.split((i.backorder as any).message).join("") }
  assert.equal(backorderNoteMatchesLines(stripped).verdict, "fail")

  // Negative control 2: note present on a line that is NOT backordered.
  const allInStock = order({ items: order().items.map((l: any) => ({ ...l, backordered: false })) })
  const overNoted = { ...input(allInStock), html: input().html }
  assert.equal(backorderNoteMatchesLines(overNoted).verdict, "fail")
})

test("undetermined backorder state is UNDETERMINED, never pass", () => {
  assert.equal(noUndeterminedBackorderLines(input()).verdict, "pass")
  const withUnknown = order({ items: [...order().items, { title: "X", quantity: 1, unit_price: 100 }] })
  const f = noUndeterminedBackorderLines({ ...input(), order: withUnknown })
  assert.equal(f.verdict, "undetermined")
  assert.notEqual(f.verdict, "pass")
})

test("unreadable content FAILS loudly; absent content does not", () => {
  assert.equal(backorderCopyReadable(input()).verdict, "pass")
  const unreadable = { ...input(), backorder: { state: "unreadable", reason: "not found" } as const }
  assert.equal(backorderCopyReadable(unreadable).verdict, "fail")
  const absent = { ...input(), backorder: { state: "absent" } as const }
  assert.equal(backorderCopyReadable(absent).verdict, "pass")
  // And with content unreadable we must not claim the notes are right.
  assert.equal(backorderNoteMatchesLines(unreadable).verdict, "undetermined")
})

test("totals add up, and FAIL when they do not", () => {
  assert.equal(totalsAddUp(input()).verdict, "pass")
  assert.equal(totalsAddUp({ ...input(), order: order({ total: 999 }) }).verdict, "fail")
  assert.equal(totalsAddUp({ ...input(), order: order({ subtotal: 1 }) }).verdict, "fail")
})

test("customer data is escaped, and the check FAILS on raw markup", () => {
  const evil = order({ customer_name: '<script>alert(1)</script>' })
  const rendered = renderOrderConfirmation(evil)
  assert.ok(!rendered.includes("<script>"), "script tag survived escaping")
  assert.equal(customerDataIsEscaped({ ...input(), html: rendered }).verdict, "pass")
  assert.equal(customerDataIsEscaped({ ...input(), html: "<script>x</script>" }).verdict, "fail")
})

test("no placeholder leakage, and the check FAILS on undefined in output", () => {
  assert.equal(noPlaceholderLeakage(input()).verdict, "pass")
  assert.equal(noPlaceholderLeakage({ ...input(), html: "<p>Total: undefined</p>" }).verdict, "fail")
  assert.equal(noPlaceholderLeakage({ ...input(), html: "<p>NaN</p>" }).verdict, "fail")
})

test("carries order date and status link, and FAILS without them", () => {
  assert.equal(hasOrderDateAndStatusLink(input()).verdict, "pass")
  const noLink = renderOrderConfirmation(order({ status_url: undefined }))
  assert.equal(hasOrderDateAndStatusLink({ ...input(), html: noLink }).verdict, "fail")
})

test("order date renders in Eastern time, not UTC", () => {
  // 2026-01-01T02:00:00Z is still 2025-12-31 in New York. UTC would say January 1.
  const html = renderOrderConfirmation(order({ created_at: "2026-01-01T02:00:00Z" }))
  assert.match(html, /December 31, 2025/)
})

test("quantity and price are not ambiguous on multi-quantity lines", () => {
  // "Qty: 2" above "$90.00" reads as ninety dollars for the pair. The arithmetic must show.
  assert.match(renderOrderConfirmation(order()), /2 &times; \$90\.00/)
  assert.match(renderOrderConfirmation(order()), /\$180\.00/)
})

test("a no-thumbnail line does not leave an empty 96px column", () => {
  const html = renderOrderConfirmation(order())
  assert.ok(!html.includes('width="96"'), "empty thumbnail cell rendered for a line with no image")
})

test("summarise: undetermined is NOT folded into pass", () => {
  const s = summarise([
    { check: "a", verdict: "pass" }, { check: "b", verdict: "undetermined" },
  ])
  assert.equal(s.clean, false, "a run with an undetermined check must not report clean")
})

test("full run over a good order is clean", () => {
  const s = summarise(runChecks(input()))
  assert.equal(s.fail, 0)
  assert.equal(s.undetermined, 0)
  assert.equal(s.clean, true)
})

/* ---------------------------------------------------------------------------------------
 * Branch-reachability audit.
 *
 * Rule from yd-promo: after adding a defensive branch, ask what would have to happen for it
 * to run — then make that happen. `backorderCopy()`'s `unreadable` state was asserted only by
 * constructing the value by hand; nothing had ever produced it from a real file.
 * ------------------------------------------------------------------------------------- */

test("BRANCH AUDIT: an unreadable content file really does produce 'unreadable'", () => {
  const prev = process.env.YD_SITE_CHROME_PATH
  try {
    process.env.YD_SITE_CHROME_PATH = "/nonexistent/definitely/not/site-chrome.json"
    const c = backorderCopy()
    assert.equal(c.state, "unreadable", "the unreadable branch is unreachable from real input")
    assert.match((c as { reason: string }).reason, /ENOENT|no such file/i)
    // ...and the email renders with no note rather than crashing or inventing one
    const html = renderOrderConfirmation(order())
    assert.ok(!/10.14 days/.test(html), "invented the promise with content unreadable")
    // ...and the check reports it as a FAILURE, not silence
    assert.equal(backorderCopyReadable({ ...input(), backorder: c }).verdict, "fail")
  } finally {
    if (prev === undefined) delete process.env.YD_SITE_CHROME_PATH
    else process.env.YD_SITE_CHROME_PATH = prev
  }
})

test("BRANCH AUDIT: malformed JSON in the content file is 'unreadable', not 'absent'", () => {
  const prev = process.env.YD_SITE_CHROME_PATH
  const tmp = `${process.env.TMPDIR || "/tmp"}/yd-bad-site-chrome-${process.pid}.json`
  try {
    writeFileSync(tmp, "{ this is not json")
    process.env.YD_SITE_CHROME_PATH = tmp
    const c = backorderCopy()
    assert.equal(c.state, "unreadable",
      "a corrupt content file read as 'absent' would silently drop Jeff's public promise")
  } finally {
    if (prev === undefined) delete process.env.YD_SITE_CHROME_PATH
    else process.env.YD_SITE_CHROME_PATH = prev
    try { unlinkSync(tmp) } catch { /* nothing to clean */ }
  }
})

test("BRANCH AUDIT: a valid file with no backorder key is 'absent' — deliberate, and silent", () => {
  const prev = process.env.YD_SITE_CHROME_PATH
  const tmp = `${process.env.TMPDIR || "/tmp"}/yd-empty-site-chrome-${process.pid}.json`
  try {
    writeFileSync(tmp, JSON.stringify({ nav: [], logo: "x" }))
    process.env.YD_SITE_CHROME_PATH = tmp
    const c = backorderCopy()
    assert.equal(c.state, "absent", "removing the promise on purpose must not read as a fault")
    assert.equal(backorderCopyReadable({ ...input(), backorder: c }).verdict, "pass")
  } finally {
    if (prev === undefined) delete process.env.YD_SITE_CHROME_PATH
    else process.env.YD_SITE_CHROME_PATH = prev
    try { unlinkSync(tmp) } catch { /* nothing to clean */ }
  }
})
