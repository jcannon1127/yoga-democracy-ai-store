import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'
import {
  EMAILPASS,
  findLoginIdentity,
  passwordMatches,
  revokeResetTokens,
} from '../../../../../lib/credentials'

/**
 * Change the signed-in customer's password.
 *
 * ── Why this route exists ──────────────────────────────────────────────────────────────
 *
 * Medusa 2.19 has no such endpoint. `POST /auth/customer/emailpass/update` looks like one, but
 * its middleware rejects any token that is not a single-use RESET token, so a session cannot
 * drive it. The Medusa starter's `ProfilePassword` component is a stub that renders three real
 * password fields and toasts "Password update is not implemented"; whoever set this storefront
 * up commented the component out of the profile page — while leaving the page's own copy saying
 * "you can also update your billing address, or change your password."
 *
 * That matters more here than on a generic store: EVERY ONE of the 115,858 migrated customers
 * arrives at cutover with a password they set minutes earlier through a reset link. Changing it
 * afterwards is the first thing a cautious customer does.
 *
 * ── Why the old password is required ───────────────────────────────────────────────────
 *
 * Without it, a borrowed session — a shared laptop, a stolen cookie — becomes a permanent
 * takeover: set a new password and the real owner is locked out of their own eleven years of
 * orders. The old password is what keeps possession of a session from being ownership of the
 * account. Everyone who can reach this route has a password by definition, so there is no
 * population this shuts out.
 *
 * ── Enumeration is not a concern here, and one thing is ─────────────────────────────────
 *
 * Unlike the reset and lookup routes, this one is behind authentication: the caller already
 * knows whose account it is. So a wrong old password may say so plainly. What it must NOT be is
 * an unlimited password oracle for a session whose owner stepped away, hence the throttle.
 */

const MIN_LENGTH = Number(process.env.CUSTOMER_PASSWORD_MIN_LENGTH || 8)

// Per-customer, not per-IP. The thing being guessed here is one account's password, and the
// attacker is holding that account's session — an IP limit would be the wrong axis.
const WINDOW_MS = Number(process.env.PASSWORD_CHANGE_WINDOW_MS || 60_000)
const MAX_PER_WINDOW = Number(process.env.PASSWORD_CHANGE_MAX_PER_WINDOW || 5)
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

type Body = { old_password?: unknown; new_password?: unknown }

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: 'Unauthorized', type: 'unauthorized' })
  }

  const oldPassword =
    typeof req.body?.old_password === 'string' ? req.body.old_password : ''
  const newPassword =
    typeof req.body?.new_password === 'string' ? req.body.new_password : ''

  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      message: 'Enter your current password and a new password.',
      type: 'invalid_data',
    })
  }
  if (newPassword.length < MIN_LENGTH) {
    return res.status(400).json({
      message: `Your new password must be at least ${MIN_LENGTH} characters.`,
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
    // Not "wrong password" and not a success. Say so: a customer whose account is in a shape
    // this route cannot act on needs a human, and silently returning 200 would be the same
    // class of lie this route was written to remove.
    console.warn(
      `[password-change] status=undetermined customer=${customerId} ` +
        'reason=no_single_emailpass_identity'
    )
    return res.status(409).json({
      message:
        'We could not update the password on this account. Please contact customer service.',
      type: 'not_allowed',
    })
  }

  if (!(await passwordMatches(req.scope, identity.entityId, oldPassword))) {
    return res.status(401).json({
      message: 'Your current password is not correct.',
      type: 'unauthorized',
    })
  }

  const auth: any = req.scope.resolve(Modules.AUTH)
  const result = await auth.updateProvider(EMAILPASS, {
    entity_id: identity.entityId,
    password: newPassword,
  })

  // `update()` on the emailpass provider returns `{ success: true }` WITHOUT touching anything
  // when the password is not a string — the same shape as a real success. Checking only
  // `success` would let a bad payload look like a completed change. The guard above makes that
  // unreachable; this asserts it rather than trusting it.
  if (!result?.success || !result?.authIdentity) {
    console.error(
      `[password-change] status=failed customer=${customerId} ` +
        `error=${result?.error ?? 'no authIdentity returned'}`
    )
    return res.status(500).json({
      message: 'We could not update your password. Please try again.',
      type: 'unexpected_state',
    })
  }

  // A new password should end any reset link already in flight.
  const revoked = await revokeResetTokens(req.scope, identity.authIdentityId)
  console.log(
    `[password-change] status=ok customer=${customerId} reset_tokens_revoked=${revoked}`
  )

  return res.status(200).json({ success: true })
}
