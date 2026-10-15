import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'
import {
  customerExistsFor,
  findLoginIdentity,
  identityExistsFor,
  moveEmail,
  passwordMatches,
} from '../../../../../lib/credentials'

/**
 * Change the signed-in customer's email address — the label AND the login together.
 *
 * ── What was there before ──────────────────────────────────────────────────────────────
 *
 * The Medusa starter's `ProfileEmail` component is live on the profile page. Its submit action
 * has the `updateCustomer` call commented out and returns `{ success: true, error: null }`
 * unconditionally, so the page renders a green "Email updated succesfully" badge and nothing
 * happens. Measured in a real browser on 2026-08-25, not inferred from the source:
 * badge shown at opacity 1, `customer.email` unchanged.
 *
 * That is the same failure as the password-reset endpoint that answered `201 Created` with no
 * subscriber listening, except this one is a button a customer can press. A customer who moves
 * house and email provider would believe their account had followed them.
 *
 * ── Why Medusa does not offer this ─────────────────────────────────────────────────────
 *
 * `StoreUpdateCustomer` omits `email` deliberately: for the emailpass provider the email IS the
 * credential — it is `provider_identity.entity_id`. Changing `customer.email` on its own moves
 * the name on the account and leaves the login on the old address, with no error anywhere. So
 * this route moves both in one transaction, or neither. See `lib/credentials.ts`.
 *
 * ── Why the password is required ───────────────────────────────────────────────────────
 *
 * Changing the email is the highest-value action an attacker holding a borrowed session can
 * take: point the account at an address they control, then use "forgot password" to lock the
 * owner out for good. Requiring the current password is what makes that need the password
 * rather than just the cookie. The live site asks for it on the same screen.
 */

// Errors here are NOT deliberately uniform, and that is the opposite of the reset and lookup
// routes on purpose. The caller is authenticated and is asking about their own account, so
// "that address is already in use" tells them something they need and reveals nothing they
// could not learn by trying to register it. The uniform-answer rule applies where the caller is
// a stranger; applying it here would just make a legitimate customer stuck.
const IN_USE = {
  message: 'That email address is already in use. Please use a different one.',
  type: 'not_allowed',
}

const WINDOW_MS = Number(process.env.EMAIL_CHANGE_WINDOW_MS || 60_000)
const MAX_PER_WINDOW = Number(process.env.EMAIL_CHANGE_MAX_PER_WINDOW || 5)
const hits = new Map<string, number[]>()

function throttled(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k)
    }
  }
  return recent.length > MAX_PER_WINDOW
}

// Deliberately permissive. This is a sanity check against typos and header injection, not an
// attempt to decide what a valid address is — RFC 5322 is wider than any regex worth writing,
// and rejecting a real customer's real address is the worse error.
const LOOKS_LIKE_EMAIL = /^[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[^\s@,;:<>"']+$/

type Body = { email?: unknown; password?: unknown }

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: 'Unauthorized', type: 'unauthorized' })
  }

  const raw = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const newEmail = raw.toLowerCase()

  if (!raw || !password) {
    return res.status(400).json({
      message: 'Enter a new email address and your password.',
      type: 'invalid_data',
    })
  }
  if (!LOOKS_LIKE_EMAIL.test(raw) || raw.length > 320) {
    return res.status(400).json({
      message: 'That does not look like an email address.',
      type: 'invalid_data',
    })
  }

  if (throttled(customerId)) {
    return res.status(429).json({
      message: 'Too many attempts. Please wait a minute and try again.',
      type: 'rate_limited',
    })
  }

  const identity = await findLoginIdentity(req.scope, customerId)
  if (!identity) {
    console.warn(
      `[email-change] status=undetermined customer=${customerId} ` +
        'reason=no_single_emailpass_identity'
    )
    return res.status(409).json({
      message:
        'We could not update the email on this account. Please contact customer service.',
      type: 'not_allowed',
    })
  }

  if (!(await passwordMatches(req.scope, identity.entityId, password))) {
    return res.status(401).json({
      message: 'Your password is not correct.',
      type: 'unauthorized',
    })
  }

  // Changing an address to itself is a no-op, not an error, and must not report "already in
  // use" against the customer's own identity.
  if (newEmail === identity.entityId.trim().toLowerCase()) {
    return res.status(200).json({ success: true, email: identity.entityId, unchanged: true })
  }

  if (
    (await identityExistsFor(req.scope, newEmail)) ||
    (await customerExistsFor(req.scope, newEmail, customerId))
  ) {
    return res.status(409).json(IN_USE)
  }

  const previous = identity.entityId
  try {
    await moveEmail(req.scope, customerId, identity, raw)
  } catch (e: any) {
    // The unique index on (entity_id, provider) is the real arbiter, not the check above: two
    // requests can pass that check at the same moment. Losing that race is "in use", not a 500.
    const msg = String(e?.message ?? e)
    if (/duplicate key|unique/i.test(msg)) {
      return res.status(409).json(IN_USE)
    }
    console.error(`[email-change] status=failed customer=${customerId} error=${msg}`)
    return res.status(500).json({
      message: 'We could not update your email address. Please try again.',
      type: 'unexpected_state',
    })
  }

  // Both halves moved, or neither did — but say which address the login is now on, because
  // "your email changed" and "your login changed" being the same fact is the whole point of
  // this route and is the thing a reader six months from now will doubt.
  console.log(
    `[email-change] status=ok customer=${customerId} login_moved_from=${previous} ` +
      `login_moved_to=${raw}`
  )

  // Told, not assumed: yd-email owns delivery. Notifying the OLD address is what turns a silent
  // takeover into one the owner hears about, so it is the address that matters most here.
  try {
    const notification: any = req.scope.resolve(Modules.NOTIFICATION)
    await notification.createNotifications([
      {
        to: previous,
        channel: process.env.NOTIFICATION_EMAIL_CHANNEL || 'email',
        template: process.env.EMAIL_CHANGED_TEMPLATE || 'customer-email-changed',
        data: { old_email: previous, new_email: raw },
      },
    ])
  } catch (e: any) {
    // A failed notification must not roll back a completed change — the customer's login has
    // already moved and telling them it failed would be false. Logged loudly instead.
    console.error(
      `[email-change] status=ok_but_unnotified customer=${customerId} ` +
        `error=${e?.message ?? String(e)}`
    )
  }

  return res.status(200).json({ success: true, email: raw })
}
