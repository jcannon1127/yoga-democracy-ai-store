/**
 * Email capture — the decision layer behind the newsletter signup.
 *
 * **The rule this file exists to encode, from yd-features and it is the right one:**
 * *ship the capture without the offer rather than the offer without the code.*
 * The live site makes a 15%-off promise on every page, and a capture that takes an address
 * and then delivers a code that does not work **breaks the promise after the customer has
 * already paid for it with their address.** That is the worst possible order.
 *
 * So this returns `subscribed_no_offer` — a real, correct, non-failing outcome — whenever a
 * usable code could not be issued. **The address is still captured.** What is withheld is the
 * offer, not the signup.
 *
 * **Enumeration.** The response to the caller must not reveal whether an address was already
 * on the list; that would turn a public form into a "does this person shop here" oracle. The
 * distinction is kept in the outcome for logging, and flattened at the route.
 */
import { classifyRecipient } from "./providers/delivery.ts"

export type CaptureOutcome =
  /** Captured, code issued, welcome email queued. */
  | { status: "subscribed_with_offer"; email: string; code: string }
  /** Captured. No usable code, so NO offer email is sent. Not a failure. */
  | { status: "subscribed_no_offer"; email: string; reason: string }
  /** Already on the list. Nothing re-sent — a second welcome code is a second liability. */
  | { status: "already_subscribed"; email: string }
  /** Not a usable address. */
  | { status: "invalid"; reason: string }

/**
 * Deliberately permissive: this is a newsletter box, not an auth boundary. It rejects what is
 * clearly not an address and lets the delivery attempt judge the rest. Over-strict validation
 * on an email field rejects real people — plus-addressing, long TLDs, apostrophes.
 */
export function normaliseEmail(raw: string): string | null {
  const e = (raw ?? "").trim().toLowerCase()
  if (!e || e.length > 254) return null
  if (/\s/.test(e)) return null
  const at = e.indexOf("@")
  if (at < 1 || at !== e.lastIndexOf("@")) return null
  const domain = e.slice(at + 1)
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null
  if (domain.includes("..")) return null

  // **Shape is judged here; REACHABILITY is delegated, deliberately.** yd-accounts made the
  // point and it was already true in this lane: its address rule lives in two places (Python
  // and SQL) and it now runs both against the shared cases, because two copies that quietly
  // drift are how a number stays plausible while being wrong. **This function WAS a second
  // copy** — permissive about shape and silently ignorant of reserved domains — so the capture
  // box would have added `anonymous-1@example.com` to the list while the send path refused it.
  //
  // Permissiveness about SHAPE is still right for a newsletter box. But a reserved domain is
  // not strictness, it is a fact: the address can never receive mail, so subscribing it only
  // adds someone who can never be reached. One rule, one implementation.
  if (classifyRecipient(e).state !== "usable") return null

  return e
}

export type CaptureDeps = {
  /** Already on the newsletter list? */
  isSubscribed: (email: string) => Promise<boolean>
  /** Add to the list. The list is the destination of record — Klaviyo today. */
  subscribe: (email: string) => Promise<void>
  /**
   * yd-promo's seam. Returns a code that WILL apply at checkout, or null if it cannot issue
   * one. **Returning null is a supported answer, not an error** — it is what triggers
   * capture-without-offer rather than a broken promise.
   */
  issueWelcomeCode: (email: string) => Promise<string | null>
}

export async function captureEmail(raw: string, deps: CaptureDeps): Promise<CaptureOutcome> {
  const email = normaliseEmail(raw)
  if (!email) return { status: "invalid", reason: "not a usable email address" }

  if (await deps.isSubscribed(email)) {
    // No second welcome. A second code is a second liability against the same person, and
    // re-sending is also how a signup form becomes a way to mail-bomb someone else.
    return { status: "already_subscribed", email }
  }

  await deps.subscribe(email)

  let code: string | null = null
  let reason = "code issuance returned nothing"
  try {
    code = await deps.issueWelcomeCode(email)
  } catch (e) {
    // A thrown issuer must NOT lose the signup we have already made.
    reason = `code issuance failed: ${(e as Error).message}`
  }

  if (!code?.trim()) return { status: "subscribed_no_offer", email, reason }
  return { status: "subscribed_with_offer", email, code }
}

/**
 * The boundary-safe entry point. **Use this from the route, not `captureEmail`.**
 *
 * **`captureEmail` alone leaks through TIMING even though its response body does not.** An
 * address already on the list returns after one fast lookup; a new one waits for a list write
 * AND for code issuance — and yd-promo's issuer creates a cart and applies the promotion to
 * prove it works, which is hundreds of milliseconds. **Identical bodies, obviously different
 * latencies: still an oracle for "is this address already on YD's list".**
 *
 * Found by applying yd-accounts' rule to my own code — *a failure mode that differs from the
 * success mode is the leak, whatever the status code says* — one layer down from where they
 * found it. **The uniform-response test I already had passed the whole time.**
 *
 * So the answer is decided from **validation alone** and everything else runs after. That is
 * also just better: a signup form should not wait on cart creation to say "thanks".
 */
export function beginCapture(
  raw: string,
  deps: CaptureDeps
): { response: { ok: boolean; message: string }; work: Promise<CaptureOutcome> } {
  const email = normaliseEmail(raw)
  if (!email) {
    const outcome: CaptureOutcome = { status: "invalid", reason: "not a usable email address" }
    return { response: publicResponse(outcome), work: Promise.resolve(outcome) }
  }
  // Decided now, from validity only. Nothing below can change it.
  const response = publicResponse({ status: "subscribed_with_offer", email, code: "" })
  // Never let a rejected promise escape as an unhandled rejection; the outcome carries it.
  const work = captureEmail(email, deps).catch(
    (e): CaptureOutcome => ({ status: "subscribed_no_offer", email,
      reason: `capture failed: ${(e as Error).message}` })
  )
  return { response, work }
}

/** What the caller sees. Identical for every non-invalid outcome — see the enumeration note. */
export function publicResponse(o: CaptureOutcome): { ok: boolean; message: string } {
  if (o.status === "invalid") {
    return { ok: false, message: "Please enter a valid email address." }
  }
  return { ok: true, message: "Thanks — check your inbox." }
}
