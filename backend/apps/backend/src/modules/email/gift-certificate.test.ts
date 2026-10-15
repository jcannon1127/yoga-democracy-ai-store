/**
 * Tests for gift certificate delivery.
 *
 * **This email IS the product.** Everywhere else a failed send costs information; here it
 * costs the whole purchase — the customer paid and the recipient got nothing, with nothing
 * erroring. So the refusal list is longer and every entry has a test.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderGiftCertificate, subject, preheader,
  type GiftCertificateData } from "./templates/gift-certificate.ts"
import { reconcileSubjects } from "./reconcile.ts"
import type { SendLog } from "./providers/outbox.ts"

const good: GiftCertificateData = {
  recipient_name: "Marina", recipient_email: "marina@realmail.co", sender_name: "Jane Sample",
  message: "Happy birthday — go pick something you love.", amount: 7500, currency_code: "usd",
  code: "GC-4AZZ-MMZS-HOP9", shop_url: "https://yd.thisisus.ai/",
}
const html = (o: Partial<GiftCertificateData> = {}) => renderGiftCertificate({ ...good, ...o })!

test("REFUSES rather than delivering something worthless", () => {
  assert.equal(renderGiftCertificate({ ...good, code: "" }), null)
  assert.equal(renderGiftCertificate({ ...good, code: "   " }), null)
  assert.equal(renderGiftCertificate({ ...good, amount: 0 }), null)
  assert.equal(renderGiftCertificate({ ...good, amount: -100 }), null)
  assert.equal(renderGiftCertificate({ ...good, amount: NaN }), null)
  assert.equal(renderGiftCertificate({ ...good, sender_name: "" }), null)
  assert.equal(renderGiftCertificate({ ...good, recipient_email: "" }), null)
  assert.equal(renderGiftCertificate({ ...good, shop_url: "" }), null)
})

test("names the sender in subject, preheader and body — it goes to a stranger", () => {
  assert.match(subject(good), /Jane Sample/)
  assert.match(preheader(good), /Jane Sample/)
  assert.match(html(), /Jane Sample/)
})

test("the preheader carries the sender but NOT the amount", () => {
  assert.ok(!/75|\$/.test(preheader(good)), "the value is visible on a lock screen")
  const m = html().match(/<div style="display:none[^"]*">([\s\S]*?)<\/div>/)
  assert.ok(m && !/\$75/.test(m[1]))
})

test("the amount and code are both present and correct", () => {
  assert.match(html(), /\$75\.00/)
  assert.match(html(), /GC-4AZZ-MMZS-HOP9/)
  assert.match(html({ amount: 12345 }), /\$123\.45/)
})

test("the buyer's message is shown and escaped", () => {
  assert.match(html(), /Happy birthday/)
  assert.ok(!/<script>/.test(html({ message: "<script>alert(1)</script>" })))
  assert.ok(!/undefined/.test(html({ message: undefined })))
})

test("an expiry is shown ONLY from a real date, never invented", () => {
  assert.ok(!/Use it by/.test(html({ expires_at: undefined })))
  const bad = html({ expires_at: "not-a-date" })
  assert.ok(!/Use it by/.test(bad), "an unparseable date produced an expiry claim on money")
  // ...and an unparseable date must behave exactly like NO date, not like a silent third state
  // that drops the reassurance and shows nothing in its place.
  assert.match(bad, /whenever you like/,
    "a bad date silently removed the reassurance without adding an expiry")
  assert.match(html({ expires_at: "2027-01-15T00:00:00Z" }), /Use it by January 1[45], 2027/)
})

test("works without a recipient name — buyers often only have an address", () => {
  const h = html({ recipient_name: undefined })
  assert.ok(!/undefined|Hi ,/.test(h))
})

test("ONE ORDER, THREE CERTIFICATES: reconciling per order would pass while two people got nothing", () => {
  const at = "2026-08-24T12:00:00Z"
  const now = Date.parse(at) + 60 * 60 * 1000
  const subjects = ["gc1", "gc2", "gc3"].map((id) => ({ id, order_id: "o1", created_at: at }))
  const log: SendLog = { state: "ok", malformed: 0, records: [
    { at, template: "gift-certificate", to: "a@x.co", order_id: "o1", subject_id: "gc1",
      action: "send" },
  ] }
  const r = reconcileSubjects(subjects, log, "gift-certificate", { now })
  assert.equal(r.verdict, "fail", "one send satisfied a three-certificate order")
  assert.deepEqual(r.missing, ["gc2", "gc3"])
})

test("all three delivered reconciles clean", () => {
  const at = "2026-08-24T12:00:00Z"
  const now = Date.parse(at) + 60 * 60 * 1000
  const subjects = ["gc1", "gc2", "gc3"].map((id) => ({ id, order_id: "o1", created_at: at }))
  const log: SendLog = { state: "ok", malformed: 0,
    records: ["gc1", "gc2", "gc3"].map((subject_id) => ({ at, template: "gift-certificate",
      to: "a@x.co", order_id: "o1", subject_id, action: "send" as const })) }
  assert.equal(reconcileSubjects(subjects, log, "gift-certificate", { now }).verdict, "pass")
})

test("the copy never contradicts itself about expiry", () => {
  // Found by rendering: "yours to spend whenever you like" sat above "Use it by January 15".
  const withExpiry = html({ expires_at: "2027-01-15T00:00:00Z" })
  assert.match(withExpiry, /Use it by/)
  assert.ok(!/whenever you like/.test(withExpiry),
    "promised the money never runs out, directly above a date on which it does")

  const noExpiry = html({ expires_at: undefined })
  assert.match(noExpiry, /whenever you like/)
  assert.ok(!/Use it by/.test(noExpiry))
})

test("'Questions?' appears once, not twice", () => {
  assert.equal((html().match(/Questions\?/g) ?? []).length, 1)
})
