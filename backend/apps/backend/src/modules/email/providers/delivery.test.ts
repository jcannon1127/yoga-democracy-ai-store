import { test } from "node:test"
import assert from "node:assert/strict"
import { decideDelivery, isAllowed, classifyRecipient } from "./delivery.ts"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const sendable = { outcome: "send", subject: "S", html: "<p>H</p>" } as const
const skipped = { outcome: "skip", reason: "voided" } as const

test("THE SAFETY PROPERTY: with no configuration at all, nothing reaches a network", () => {
  const d = decideDelivery(sendable, "someone@realdomain.co", {})
  assert.equal(d.action, "preview")
})

test("a real transport requires deliberate configuration", () => {
  assert.equal(decideDelivery(sendable, "a@b.c", { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://h" }).action, "send")
  // ...and refuses to half-work
  assert.equal(decideDelivery(sendable, "a@b.c", { EMAIL_TRANSPORT: "smtp" }).action, "misconfigured")
  assert.equal(decideDelivery(sendable, "a@b.c", { EMAIL_TRANSPORT: "carrier-pigeon" }).action, "misconfigured")
})

test("the allowlist BLOCKS rather than silently dropping", () => {
  const env = { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://h",
    EMAIL_RECIPIENT_ALLOWLIST: "jeff@yogademocracy.com,@probe-domain.co" }
  assert.equal(decideDelivery(sendable, "jeff@yogademocracy.com", env).action, "send")
  assert.equal(decideDelivery(sendable, "probe@probe-domain.co", env).action, "send")
  const blocked = decideDelivery(sendable, "real.customer@gmail.com", env)
  assert.equal(blocked.action, "blocked")
  assert.match((blocked as { reason: string }).reason, /refusing to send/)
})

test("allowlist matching is exact or by domain suffix, and case-insensitive", () => {
  assert.ok(isAllowed("JEFF@YogaDemocracy.com", "jeff@yogademocracy.com"))
  assert.ok(isAllowed("x@example.invalid", "@example.invalid"))
  assert.ok(!isAllowed("jeffx@yogademocracy.com", "jeff@yogademocracy.com"))
  assert.ok(!isAllowed("a@notexample.invalid", "@example.invalid"))
  // An empty list is "no restriction", NOT "block everything" — but preview is still the default.
  assert.ok(isAllowed("anyone@anywhere.com", ""))
  assert.ok(isAllowed("anyone@anywhere.com", undefined))
})

test("a deliberate skip is never confused with a failure or a send", () => {
  const d = decideDelivery(skipped, "a@b.c", { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://h" })
  assert.equal(d.action, "skip")
  assert.equal((d as { reason: string }).reason, "voided")
})

test("a missing recipient is misconfigured, not a silent no-op", () => {
  assert.equal(decideDelivery(sendable, "", {}).action, "misconfigured")
  assert.equal(decideDelivery(sendable, "   ", {}).action, "misconfigured")
})

test("skip is decided BEFORE the recipient check — a voided label needs no address", () => {
  assert.equal(decideDelivery(skipped, "", {}).action, "skip")
})

// ── an address that cannot receive mail is never a send ────────────────────────────────────

test("RESERVED ADDRESSES ARE BLOCKED, NOT SENT — 541 YD customers carry anonymous-N@example.com", () => {
  for (const to of ["anonymous-48213@example.com", "x@example.net", "x@example.org",
    "x@foo.test", "x@foo.invalid", "x@foo.localhost", "x@thing.example", "X@EXAMPLE.COM"]) {
    const d = decideDelivery(sendable, to, { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://x" })
    assert.equal(d.action, "blocked", to)
    assert.match((d as { reason: string }).reason, /RFC 2606|reserved/i)
  }
})

test("A RESERVED ADDRESS IS REFUSED IN PREVIEW TOO — letting it through is how it comes to look normal", () => {
  const d = decideDelivery(sendable, "anonymous-1@example.com", {})
  assert.equal(d.action, "blocked", "preview must not make an impossible address look fine")
})

test("malformed addresses are misconfigured, and reserved ones are not lumped in with them", () => {
  for (const to of ["", "   ", "nodomain", "a@b", "a@@b.co", "a b@c.co", "@c.co", "a@.co", "a@c."]) {
    assert.equal(decideDelivery(sendable, to, {}).action, "misconfigured", JSON.stringify(to))
  }
  assert.equal(classifyRecipient("anonymous-1@example.com").state, "reserved")
  assert.equal(classifyRecipient("real@yogademocracy.com").state, "usable")
})

test("a lookalike domain is NOT reserved — the rule must not over-block real customers", () => {
  for (const to of ["a@notexample.com", "a@example.com.co", "a@myexample.com",
    "a@testing.co", "a@invalid-co.com"]) {
    assert.equal(classifyRecipient(to).state, "usable", to)
  }
})

// ── the shared contract with yd-accounts ───────────────────────────────────────────────────

test("SHARED CASES: yd-email and yd-accounts must agree on the OUTCOME for every one", () => {
  // data/reserved-address-cases.json is asserted independently by both implementations —
  // shared cases, NOT shared code. Two instruments that can disagree are the detector: that
  // pairing found two real gaps in one evening, and in both the population count did not move,
  // so nothing else would have flagged them. See the file's own _why_shared_cases note.
  const here = dirname(fileURLToPath(import.meta.url))
  const file = resolve(here, "../../../../../../../../data/reserved-address-cases.json")
  const { cases } = JSON.parse(readFileSync(file, "utf8")) as {
    cases: { address: string; outcome: "refuse" | "allow"; why: string }[]
  }
  assert.ok(cases.length >= 20, "the shared case file looks truncated")

  for (const c of cases) {
    const state = classifyRecipient(c.address).state
    const refused = state !== "usable"
    assert.equal(refused, c.outcome === "refuse",
      `${c.address}: shared contract says ${c.outcome}, this classifier says ${state} — ${c.why}`)
  }
  // The contract is the OUTCOME only. We deliberately do NOT assert the reason: yd-email calls
  // a bare "x@test" malformed because its rule wants a dot in the domain, yd-accounts calls it
  // reserved. Same refusal, different label, neither wrong.
})

test("A SINGLE-LABEL DOMAIN CANNOT RESOLVE, so it is refused — the disagreement this pairing found", () => {
  for (const a of ["x@mytest", "x@yogademocracy", "x@localhost"]) {
    assert.notEqual(classifyRecipient(a).state, "usable", a)
  }
  assert.equal(classifyRecipient("x@yogademocracy.com").state, "usable")
})
