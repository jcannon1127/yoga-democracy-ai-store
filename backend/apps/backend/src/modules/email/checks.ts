/**
 * Checks over a rendered transactional email.
 *
 * **One set of checks, two callers.** These run as build-time tests against fixtures today,
 * and are the same functions a runtime detector will run over real sends once a send path
 * exists. Duplicating the logic into a separate detector is how the two drift until the
 * detector is quietly checking something the sender no longer does.
 *
 * **Every check can return `undetermined`, and that is not a pass.** yd-store shipped a
 * completion guard that went 13/13 green while its query returned nothing — "wired, green,
 * inert". The email version is worse, because a detector that cannot see sends reports zero
 * failures, which looks exactly like everything working. So the verdict is three-valued and
 * a caller that treats `undetermined` as `pass` has defeated the point.
 */

export type Verdict = "pass" | "fail" | "undetermined"

export type Finding = {
  check: string
  verdict: Verdict
  /** Why. Always populated for fail and undetermined. */
  detail?: string
}

export type CheckInput = {
  html: string
  subject: string
  /** The order the email was rendered from, when available. Absent for a send observed in
   *  the wild with no matching order — which is `undetermined`, never `pass`. */
  order?: {
    items: Array<{ backordered?: boolean; quantity: number; unit_price: number }>
    subtotal: number
    discount_total?: number
    shipping_total: number
    tax_total: number
    total: number
  }
  /** Result of reading the backorder copy from content. */
  backorder: { state: "ok"; message: string } | { state: "absent" } | { state: "unreadable"; reason: string }
}

const ok = (check: string): Finding => ({ check, verdict: "pass" })
const bad = (check: string, detail: string): Finding => ({ check, verdict: "fail", detail })
const unk = (check: string, detail: string): Finding => ({ check, verdict: "undetermined", detail })

/**
 * The subject must not be the sender string.
 *
 * **This is not hypothetical.** Live SFCC confirmations have carried
 * `Subject: Yoga Democracy <cs@yogademocracy.com>` since somewhere between 2025-10-28 and
 * 2026-02-26 — the From value written into the Subject field. Nothing errored and nobody
 * internally ever saw it.
 */
export function subjectIsNotSenderString(i: CheckInput): Finding {
  const c = "subject_is_not_sender_string"
  if (!i.subject?.trim()) return bad(c, "subject is empty")
  if (i.subject.includes("@") || /<[^>]+>/.test(i.subject)) {
    return bad(c, `subject looks like an address or From string: ${JSON.stringify(i.subject)}`)
  }
  return ok(c)
}

/**
 * The backorder note must appear on exactly the lines that are actually backordered.
 *
 * A note on an in-stock line is a false delay promise on an item already in a box; a missing
 * note on a backordered line is the silent failure this lane exists to prevent.
 */
export function backorderNoteMatchesLines(i: CheckInput): Finding {
  const c = "backorder_note_matches_lines"
  if (i.backorder.state === "unreadable") {
    return unk(c, `cannot read backorder copy, so cannot judge notes: ${i.backorder.reason}`)
  }
  if (!i.order) return unk(c, "no source order available to compare against")
  if (i.backorder.state === "absent") {
    return ok(c) // No promise to make; absence of notes is correct.
  }
  const needle = i.backorder.message
  const rendered = i.html.split(needle).length - 1
  const expected = i.order.items.filter((l) => l.backordered === true).length
  if (rendered !== expected) {
    return bad(c, `${rendered} note(s) rendered, ${expected} line(s) actually backordered`)
  }
  return ok(c)
}

/** A line whose backorder state was never determined must be surfaced, not silently un-noted. */
export function noUndeterminedBackorderLines(i: CheckInput): Finding {
  const c = "no_undetermined_backorder_lines"
  if (!i.order) return unk(c, "no source order available")
  const n = i.order.items.filter((l) => l.backordered === undefined).length
  if (n > 0) {
    return unk(c, `${n} line(s) have no backorder determination; email renders no note for them`)
  }
  return ok(c)
}

/** Content unreadable is a wiring fault and must be loud. Content absent is an editorial choice. */
export function backorderCopyReadable(i: CheckInput): Finding {
  const c = "backorder_copy_readable"
  if (i.backorder.state === "unreadable") return bad(c, i.backorder.reason)
  return ok(c)
}

/** The arithmetic on a money document must add up. */
export function totalsAddUp(i: CheckInput): Finding {
  const c = "totals_add_up"
  if (!i.order) return unk(c, "no source order available")
  const o = i.order
  const lines = o.items.reduce((s, l) => s + l.unit_price * l.quantity, 0)
  if (lines !== o.subtotal) return bad(c, `line sum ${lines} != subtotal ${o.subtotal}`)
  const expect = o.subtotal - (o.discount_total ?? 0) + o.shipping_total + o.tax_total
  if (expect !== o.total) return bad(c, `subtotal-discount+shipping+tax = ${expect} != total ${o.total}`)
  return ok(c)
}

/** Customer-supplied data must be escaped: names and addresses reach this template raw. */
export function customerDataIsEscaped(i: CheckInput): Finding {
  const c = "customer_data_is_escaped"
  if (/<script|onerror=|onload=/i.test(i.html)) return bad(c, "unescaped script or handler in output")
  return ok(c)
}

/** Nothing that reveals a missing value should reach a customer. */
export function noPlaceholderLeakage(i: CheckInput): Finding {
  const c = "no_placeholder_leakage"
  const body = i.html.replace(/<!--[\s\S]*?-->/g, "")
  for (const t of ["undefined", "NaN", "[object Object]", "${"]) {
    if (body.includes(t)) return bad(c, `rendered output contains ${JSON.stringify(t)}`)
    // **The SUBJECT was accepted by this function and never inspected.** It is the one part a
    // customer reads BEFORE opening, and the one part a broken value is most visible in — YD's
    // live order confirmation has shipped for months with the literal subject
    // "Yoga Democracy <cs@yogademocracy.com>", the From header leaking into the Subject field.
    // A leak check that skips the subject is watching the room and not the door.
    if (i.subject?.includes(t)) {
      return bad(c, `SUBJECT LINE contains ${JSON.stringify(t)} — visible in the inbox unopened`)
    }
  }
  return ok(c)
}

/** The three things the SFCC confirmation lacks and this one must not. */
export function hasOrderDateAndStatusLink(i: CheckInput): Finding {
  const c = "has_order_date_and_status_link"
  const missing: string[] = []
  if (!/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(i.html)) {
    missing.push("order date")
  }
  if (!/href="[^"]*\/orders?\//i.test(i.html)) missing.push("order status link")
  return missing.length ? bad(c, `missing: ${missing.join(", ")}`) : ok(c)
}

export const ALL_CHECKS = [
  subjectIsNotSenderString,
  backorderCopyReadable,
  backorderNoteMatchesLines,
  noUndeterminedBackorderLines,
  totalsAddUp,
  customerDataIsEscaped,
  noPlaceholderLeakage,
  hasOrderDateAndStatusLink,
]

export function runChecks(i: CheckInput): Finding[] {
  return ALL_CHECKS.map((f) => f(i))
}

/**
 * **`undetermined` is never folded into `pass`.** A caller that wants a boolean has to decide
 * explicitly what to do with "I could not tell", which is the whole point.
 */
export function summarise(fs: Finding[]): { pass: number; fail: number; undetermined: number; clean: boolean } {
  const pass = fs.filter((f) => f.verdict === "pass").length
  const fail = fs.filter((f) => f.verdict === "fail").length
  const undetermined = fs.filter((f) => f.verdict === "undetermined").length
  return { pass, fail, undetermined, clean: fail === 0 && undetermined === 0 }
}

/* ------------------------------------------------------------------------------------------
 * Password reset
 *
 * Different failure modes from a confirmation: this email carries a **live credential in a
 * URL**, and it is the one email that, if it does not arrive, locks a customer out entirely.
 * ---------------------------------------------------------------------------------------- */

export type ResetCheckInput = {
  html: string
  subject: string
  data: { reset_url: string; email: string; token_expires_minutes?: number }
}

/** The URL must appear exactly as yd-accounts built it. Reassembling or re-encoding it here
 *  would put the origin in two places and silently break the token. */
export function resetUrlRenderedVerbatim(i: ResetCheckInput): Finding {
  const c = "reset_url_rendered_verbatim"
  if (!i.data.reset_url) return unk(c, "no reset_url supplied")
  const escaped = i.data.reset_url.replace(/&/g, "&amp;")
  const present = i.html.includes(i.data.reset_url) || i.html.includes(escaped)
  return present ? ok(c) : bad(c, "reset_url does not appear verbatim in the rendered email")
}

/**
 * **The preheader must carry no credential and no address.** It is rendered in list view and
 * on lock screens without the message being opened — a token visible there is a token visible
 * to anyone holding the phone.
 */
export function preheaderCarriesNoSecret(i: ResetCheckInput): Finding {
  const c = "preheader_carries_no_secret"
  const m = i.html.match(/<div style="display:none[^"]*">([\s\S]*?)<\/div>/)
  if (!m) return unk(c, "no preheader block found to inspect")
  const pre = m[1]
  const token = /[?&]token=([^&"'\s]+)/.exec(i.data.reset_url)?.[1]
  if (token && pre.includes(token)) return bad(c, "preheader contains the reset token")
  if (pre.includes(i.data.reset_url)) return bad(c, "preheader contains the reset URL")
  if (i.data.email && pre.includes(i.data.email)) return bad(c, "preheader contains the customer email")
  return ok(c)
}

/** State the expiry when it is known. Absent is `undetermined` — never invent a number, and
 *  never let the page and the email disagree about how long the customer has. */
export function expiryStated(i: ResetCheckInput): Finding {
  const c = "expiry_stated"
  const n = i.data.token_expires_minutes
  if (typeof n !== "number" || n <= 0) {
    return unk(c, "token_expires_minutes not supplied; email states no expiry")
  }
  return i.html.includes(String(n)) ? ok(c) : bad(c, `expiry ${n} not stated in the email`)
}

/** A customer who did not request this must be told they need do nothing. */
export function statesNoActionIfUnrequested(i: ResetCheckInput): Finding {
  const c = "states_no_action_if_unrequested"
  return /wasn't you|was not you|didn't request|did not request/i.test(i.html)
    ? ok(c) : bad(c, "no reassurance for a customer who did not request the reset")
}

/**
 * **The reset URL must be the actual `href`, not merely present somewhere in the page.**
 *
 * Found by mutation: re-encoding the URL inside `href` while leaving the visible text intact
 * left `resetUrlRenderedVerbatim` passing and the link broken. The customer sees a correct
 * URL, clicks it, and lands nowhere. Checking that a string appears in the HTML is not the
 * same as checking that the link works — the same artefact-versus-event mistake that has cost
 * this project a day.
 */
export function resetUrlIsTheHref(i: ResetCheckInput): Finding {
  const c = "reset_url_is_the_href"
  if (!i.data.reset_url) return unk(c, "no reset_url supplied")
  const hrefs = [...i.html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
    .filter((h) => !h.startsWith("mailto:"))
  if (!hrefs.length) return bad(c, "no linked href in the email at all")
  const wrong = hrefs.filter((h) => h !== i.data.reset_url)
  if (wrong.length) return bad(c, `href does not equal reset_url: ${JSON.stringify(wrong[0].slice(0, 80))}`)
  return ok(c)
}

/**
 * **Never render a unit with no number.** Forcing the expiry block on with no value produced
 * "expires in  minutes" — grammatical, meaningless, and invisible to a check that only looked
 * for an invented digit. Found by mutation.
 */
export function noBlankQuantity(i: ResetCheckInput): Finding {
  const c = "no_blank_quantity"
  const text = i.html.replace(/<[^>]+>/g, " ")
  for (const unit of ["minutes", "hours", "days"]) {
    const re = new RegExp(`(\\S+)\\s+${unit}\\b`, "g")
    for (const m of text.matchAll(re)) {
      if (!/\d/.test(m[1])) return bad(c, `"${m[0].trim()}" has no number before "${unit}"`)
    }
    if (new RegExp(`(^|\\s)\\s*${unit}\\b`).test(text) && !new RegExp(`\\d\\s*${unit}`).test(text)) {
      return bad(c, `"${unit}" appears with no quantity`)
    }
  }
  return ok(c)
}

export const RESET_CHECKS = [
  resetUrlIsTheHref,
  noBlankQuantity,
  resetUrlRenderedVerbatim,
  preheaderCarriesNoSecret,
  expiryStated,
  statesNoActionIfUnrequested,
]

export function runResetChecks(i: ResetCheckInput): Finding[] {
  const generic = [
    subjectIsNotSenderString({ html: i.html, subject: i.subject, backorder: { state: "absent" } }),
    noPlaceholderLeakage({ html: i.html, subject: i.subject, backorder: { state: "absent" } }),
    customerDataIsEscaped({ html: i.html, subject: i.subject, backorder: { state: "absent" } }),
  ]
  return [...generic, ...RESET_CHECKS.map((f) => f(i))]
}

/* ------------------------------------------------------------------------------------------
 * Welcome
 * ---------------------------------------------------------------------------------------- */

export type WelcomeCheckInput = {
  html: string
  subject: string
  data: { code: string; percent: number }
  /** The percent on the PROMOTION RECORD, fetched independently of whatever was passed to the
   *  template. Absent means the check cannot run — `undetermined`, not `pass`. */
  promotion_percent?: number
}

/**
 * **The advertised percent must equal the promotion that will actually be applied.**
 *
 * yd-promo gates the promotion record against drift, but that gate cannot see this email — so
 * if Jeff changes the welcome discount from 15% to 20%, the promotion moves and the email can
 * keep advertising the old number with nothing erroring. This is the same class as a price
 * shown in one place disagreeing with the price charged: the customer is told one thing and
 * billed another, and only they find out.
 */
export function welcomePercentMatchesPromotion(i: WelcomeCheckInput): Finding {
  const c = "welcome_percent_matches_promotion"
  if (typeof i.promotion_percent !== "number") {
    return unk(c, "no promotion record supplied; cannot confirm the advertised percent is real")
  }
  if (i.data.percent !== i.promotion_percent) {
    return bad(c, `email advertises ${i.data.percent}%, promotion grants ${i.promotion_percent}%`)
  }
  if (!i.html.includes(`${i.promotion_percent}%`)) {
    return bad(c, `rendered email does not state ${i.promotion_percent}%`)
  }
  return ok(c)
}

/** The code must be present and intact — it is the entire point of the message. */
export function welcomeCodePresent(i: WelcomeCheckInput): Finding {
  const c = "welcome_code_present"
  if (!i.data.code?.trim()) return bad(c, "no code supplied; this email must not be sent at all")
  return i.html.includes(i.data.code) ? ok(c) : bad(c, "code missing from the rendered email")
}

export function runWelcomeChecks(i: WelcomeCheckInput): Finding[] {
  const generic = [
    subjectIsNotSenderString({ html: i.html, subject: i.subject, backorder: { state: "absent" } }),
    noPlaceholderLeakage({ html: i.html, subject: i.subject, backorder: { state: "absent" } }),
    customerDataIsEscaped({ html: i.html, subject: i.subject, backorder: { state: "absent" } }),
  ]
  return [...generic, welcomeCodePresent(i), welcomePercentMatchesPromotion(i)]
}
