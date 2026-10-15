import { test } from "node:test"
import assert from "node:assert/strict"
import { captureEmail, beginCapture, normaliseEmail, publicResponse,
  type CaptureDeps } from "./capture.ts"

const deps = (over: Partial<CaptureDeps> = {}): CaptureDeps & { subscribed: string[] } => {
  const subscribed: string[] = []
  return {
    subscribed,
    isSubscribed: async () => false,
    subscribe: async (e) => { subscribed.push(e) },
    issueWelcomeCode: async () => "welcome-A-B-C-D",
    ...over,
  } as never
}

test("normalises and rejects what is clearly not an address", () => {
  assert.equal(normaliseEmail("  Jane@RealMail.CO "), "jane@realmail.co")
  assert.equal(normaliseEmail("jane+yd@example.co.uk"), "jane+yd@example.co.uk")
  for (const bad of ["", "   ", "jane", "jane@", "@example.com", "a b@example.com",
                     "a@@b.com", "a@b", "a@.com", "a@b.", "a@b..com"]) {
    assert.equal(normaliseEmail(bad), null, `should reject ${JSON.stringify(bad)}`)
  }
})

test("THE RULE: no usable code means captured WITHOUT an offer — never a broken promise", async () => {
  const d = deps({ issueWelcomeCode: async () => null })
  const r = await captureEmail("jane@realmail.co", d)
  assert.equal(r.status, "subscribed_no_offer")
  // ...and the signup is NOT lost
  assert.deepEqual(d.subscribed, ["jane@realmail.co"])
})

test("an issuer that THROWS still keeps the signup", async () => {
  const d = deps({ issueWelcomeCode: async () => { throw new Error("promo service down") } })
  const r = await captureEmail("jane@realmail.co", d)
  assert.equal(r.status, "subscribed_no_offer")
  assert.match((r as { reason: string }).reason, /promo service down/)
  assert.deepEqual(d.subscribed, ["jane@realmail.co"])
})

test("a working code gives capture WITH offer", async () => {
  const r = await captureEmail("jane@realmail.co", deps())
  assert.equal(r.status, "subscribed_with_offer")
  assert.equal((r as { code: string }).code, "welcome-A-B-C-D")
})

test("an existing subscriber gets no second code and no second email", async () => {
  const d = deps({ isSubscribed: async () => true,
    issueWelcomeCode: async () => { throw new Error("must not be called") } })
  const r = await captureEmail("jane@realmail.co", d)
  assert.equal(r.status, "already_subscribed")
  assert.deepEqual(d.subscribed, [], "re-subscribed an address that was already on the list")
})

test("the public response does not reveal whether the address was already known", () => {
  const a = publicResponse({ status: "subscribed_with_offer", email: "x@y.z", code: "c" })
  const b = publicResponse({ status: "already_subscribed", email: "x@y.z" })
  const c = publicResponse({ status: "subscribed_no_offer", email: "x@y.z", reason: "r" })
  assert.deepEqual(a, b, "response differs between new and existing subscriber")
  assert.deepEqual(a, c, "response reveals that no offer was issued")
  assert.equal(publicResponse({ status: "invalid", reason: "r" }).ok, false)
})

test("a blank submission never reaches the list", async () => {
  const d = deps()
  assert.equal((await captureEmail("   ", d)).status, "invalid")
  assert.deepEqual(d.subscribed, [])
})

test("TIMING ORACLE: the answer is produced without waiting on ANY subscription work", async () => {
  // Deps that never settle. If the response depends on them, this test cannot finish.
  const never = <T>() => new Promise<T>(() => {})
  const d = { isSubscribed: () => never<boolean>(), subscribe: () => never<void>(),
    issueWelcomeCode: () => never<string | null>() } as never
  const { response } = beginCapture("jane@realmail.co", d)
  assert.deepEqual(response, { ok: true, message: "Thanks — check your inbox." })
})

test("the answer is byte-identical for an existing and a brand-new address", () => {
  const existing = { isSubscribed: async () => true, subscribe: async () => {},
    issueWelcomeCode: async () => "c" } as never
  const fresh = { isSubscribed: async () => false, subscribe: async () => {},
    issueWelcomeCode: async () => "c" } as never
  assert.deepEqual(beginCapture("a@b.co", existing).response,
                   beginCapture("a@b.co", fresh).response)
})

test("an invalid address is still rejected, and still does no work", async () => {
  let touched = false
  const d = { isSubscribed: async () => { touched = true; return false },
    subscribe: async () => { touched = true }, issueWelcomeCode: async () => null } as never
  const { response, work } = beginCapture("nope", d)
  assert.equal(response.ok, false)
  assert.equal((await work).status, "invalid")
  assert.equal(touched, false)
})

test("work that throws is captured as an outcome, never an unhandled rejection", async () => {
  const d = { isSubscribed: async () => { throw new Error("list down") },
    subscribe: async () => {}, issueWelcomeCode: async () => null } as never
  const { response, work } = beginCapture("a@b.co", d)
  assert.equal(response.ok, true, "a broken list must not change what the caller sees")
  assert.match((await work as { reason: string }).reason, /list down/)
})

test("CAPTURE REFUSES AN ADDRESS THAT CAN NEVER RECEIVE MAIL — one rule, not two", () => {
  // This function used to judge shape only, so the newsletter box would have accepted
  // anonymous-1@example.com while the send path blocked it: two copies of the same question,
  // quietly disagreeing. Reachability is now delegated to classifyRecipient.
  for (const e of ["anonymous-48213@example.com", "x@example.net", "x@foo.invalid",
    "x@foo.test", "x@mytest"]) {
    assert.equal(normaliseEmail(e), null, e)
  }
  // and it stays permissive about SHAPE, which is the point of a newsletter box
  for (const e of ["jane+yd@realmail.co", "o'brien@realmail.co", "a@b.museum",
    "  Jane@RealMail.co  "]) {
    assert.ok(normaliseEmail(e), e)
  }
})
