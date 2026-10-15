/**
 * What to actually DO with a rendered email.
 *
 * **Separated from the Medusa provider glue on purpose: this is the part with the safety
 * property, and it must be testable without a running Medusa.**
 *
 * **The property: this cannot send real mail unless somebody deliberately configured it to.**
 * The default is `preview` — write the HTML to disk and log a marker, touching no network.
 * Sending to a real customer is the one irreversible action in this lane, and a default that
 * required someone to remember to turn it OFF would be the wrong way round.
 *
 * There is also a recipient allowlist, because "we only meant to test" is how test sends reach
 * real customers. When `EMAIL_RECIPIENT_ALLOWLIST` is set, anything not matching is refused —
 * loudly, as `blocked`, never quietly dropped.
 */
import type { Rendered } from "../registry.ts"

export type Env = Record<string, string | undefined>

export type Delivery =
  /** Write the HTML somewhere a human can look at it. No network. */
  | { action: "preview"; dir: string; subject: string; html: string; to: string }
  /** Hand to a real transport. Only reachable by explicit configuration. */
  | { action: "send"; via: string; to: string; subject: string; html: string }
  /** The template deliberately produced nothing. Not a failure. */
  | { action: "skip"; reason: string }
  /** Refused for safety. A failure, and must be loud. */
  | { action: "blocked"; reason: string }
  /** Cannot proceed — misconfiguration. Loud. */
  | { action: "misconfigured"; reason: string }

/**
 * Can this address receive mail AT ALL — as distinct from whether we managed to send to it.
 *
 * **yd-accounts hit exactly this and named it: its own detector counted all 115,858 imported
 * customers as reachable for three days, because it checked whether a reset link could be
 * GENERATED and never whether it could be DELIVERED.** Those look identical from the auth
 * tables. **They looked identical here too:** `decideDelivery` checked only that `to` was
 * non-empty, so `anonymous-48213@example.com` produced a `send` record, `deliveredSends`
 * counted it, and `reconcileFromLog` reported the order as emailed. **A clean pass for a
 * customer who cannot receive anything.** That is precisely the silent success this lane
 * exists to prevent, sitting in the lane.
 *
 * **541 of YD's imported customers carry these** — almost all `anonymous-<digits>@example.com`,
 * SFCC's guest-checkout placeholder, and they own 631 historical orders. At cutover every
 * customer is forced through a password reset, so each of them will be sent to an inbox that
 * cannot exist.
 *
 * Reserved by RFC 2606 and RFC 6761 — these are guaranteed never to resolve, so refusing them
 * is a fact about the address, not a policy choice.
 */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"])
const RESERVED_TLDS = ["example", "test", "invalid", "localhost"]

export type Recipient =
  | { state: "usable" }
  /** Well-formed but guaranteed undeliverable. Never a send. */
  | { state: "reserved"; detail: string }
  /** Not an address at all. */
  | { state: "malformed"; detail: string }

export function classifyRecipient(to: string | undefined | null): Recipient {
  const t = (to ?? "").trim()
  if (!t) return { state: "malformed", detail: "no recipient address" }
  if (/\s/.test(t)) return { state: "malformed", detail: "address contains whitespace" }

  const at = t.lastIndexOf("@")
  if (at <= 0 || at === t.length - 1 || t.indexOf("@") !== at) {
    return { state: "malformed", detail: `not a single local@domain address: ${JSON.stringify(t)}` }
  }
  const domain = t.slice(at + 1).toLowerCase()
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return { state: "malformed", detail: `domain is not a hostname: ${JSON.stringify(domain)}` }
  }

  const tld = domain.slice(domain.lastIndexOf(".") + 1)
  if (RESERVED_DOMAINS.has(domain) || RESERVED_TLDS.includes(tld)) {
    return { state: "reserved",
      detail: `${domain} is reserved by RFC 2606/6761 and can never receive mail — ` +
        `this address is a placeholder, not a customer. Sending would record a delivery that ` +
        `cannot happen. IF THIS IS A TEST FIXTURE, use a non-reserved domain: ` +
        `@example.com is the reflexive stand-in for "a normal address" precisely BECAUSE it ` +
        `is reserved, so every fixture using it as valid inverts its meaning here.` }
  }
  return { state: "usable" }
}

/** Case-insensitive; an entry may be a full address or a `@domain` suffix. */
export function isAllowed(to: string, allowlist: string | undefined): boolean {
  if (!allowlist?.trim()) return true // no list configured = no restriction
  const t = to.trim().toLowerCase()
  return allowlist.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    .some((e) => (e.startsWith("@") ? t.endsWith(e) : t === e))
}

export function decideDelivery(r: Rendered, to: string, env: Env): Delivery {
  if (r.outcome === "skip") return { action: "skip", reason: r.reason }

  // **Before anything about transports.** An address that cannot receive mail cannot receive
  // it in preview either, and letting one through as `preview` in development is how it comes
  // to look normal. The refusal is a fact about the address, not about configuration.
  const who = classifyRecipient(to)
  if (who.state === "malformed") {
    return { action: "misconfigured", reason: who.detail }
  }
  if (who.state === "reserved") {
    return { action: "blocked", reason: who.detail }
  }

  const transport = (env.EMAIL_TRANSPORT || "preview").trim().toLowerCase()

  if (transport === "preview") {
    return { action: "preview", dir: env.EMAIL_PREVIEW_DIR || "outputs/email-outbox",
      subject: r.subject, html: r.html, to }
  }

  // Anything past here can reach a real inbox.
  if (!isAllowed(to, env.EMAIL_RECIPIENT_ALLOWLIST)) {
    return { action: "blocked",
      reason: `recipient ${to} is not in EMAIL_RECIPIENT_ALLOWLIST — refusing to send` }
  }

  if (transport === "smtp") {
    if (!env.SMTP_URL?.trim()) {
      return { action: "misconfigured", reason: "EMAIL_TRANSPORT=smtp but SMTP_URL is unset" }
    }
    return { action: "send", via: "smtp", to, subject: r.subject, html: r.html }
  }

  return { action: "misconfigured", reason: `unknown EMAIL_TRANSPORT ${JSON.stringify(transport)}` }
}
