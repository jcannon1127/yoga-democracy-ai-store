import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

/**
 * Deliver the password-reset token.
 *
 * WHY THIS FILE EXISTS AT ALL — read before deleting or "simplifying" it.
 *
 * Medusa's `POST /auth/customer/emailpass/reset-password` answers **201 Created** whether or
 * not anything is listening to the `auth.password_reset` event it emits. Before this
 * subscriber, YD's Medusa had no notification module and an empty `src/subscribers/`, so
 * every reset request returned 201 and the token went nowhere. A reviewer testing by status
 * code would have marked password reset working. It was not working; it did not exist.
 *
 * That matters more here than on a normal store: SFCC's password hashes are not portable, so
 * **every customer resets at cutover**. This path is the front door for the whole base.
 *
 * ── Two rules encoded here that look like bugs and are not ──────────────────────────────
 *
 * 1. NEVER let the outcome of this subscriber change what the caller sees. The endpoint
 *    already answers identically for a known and an unknown email (verified: both 201), and
 *    that uniformity is the *only* thing stopping this endpoint from being an account
 *    enumeration oracle. Everywhere else in this project "could not determine" must be loud
 *    and distinct from "nothing wrong". Here it must not be — to the caller. It still is to
 *    us, via the log lines below.
 *
 * 2. A failed send must be LOUD IN THE LOG even though it is silent to the customer.
 *    A reset email that is never sent looks exactly like a customer who changed their mind:
 *    a request with no completion. The `[reset-delivery]` marker is what lets the
 *    password-reset detector tell those two apart, so do not soften it to a warning and do
 *    not swallow the error.
 */

const MARKER = '[reset-delivery]'

export default async function authPasswordResetHandler({
  event,
  container,
}: SubscriberArgs<{
  entity_id: string
  actor_type: string
  token: string
  metadata?: Record<string, unknown>
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { entity_id: identifier, actor_type: actorType, token } = event.data

  // Staff and customer resets are different audiences with different destinations. Only the
  // storefront audience is ours; anything else is left alone rather than mis-delivered.
  const customerActorType = process.env.AUTH_CUSTOMER_ACTOR_TYPE || 'customer'
  if (actorType !== customerActorType) {
    return
  }

  // Config, not a literal — rule 2 of the tenancy discipline, and it is also just correct:
  // this URL differs between the preview origin and production.
  const storefrontUrl = process.env.STOREFRONT_URL
  if (!storefrontUrl) {
    // A missing input must never become a permissive answer. We cannot build a working link
    // without an origin, so say so at error level rather than emitting a broken one.
    logger.error(
      `${MARKER} status=misconfigured reason=STOREFRONT_URL_unset actor=${actorType} ` +
        `— a reset was requested and NO email can be built. Set STOREFRONT_URL.`
    )
    return
  }

  const resetPath = process.env.RESET_PASSWORD_PATH || '/account/reset-password'
  const resetUrl =
    `${storefrontUrl.replace(/\/+$/, '')}${resetPath}` +
    `?token=${encodeURIComponent(token)}&email=${encodeURIComponent(identifier)}`

  const templateId = process.env.RESET_PASSWORD_TEMPLATE_ID || 'password-reset'
  const channel = process.env.NOTIFICATION_EMAIL_CHANNEL || 'email'

  let notification: any
  try {
    notification = container.resolve(Modules.NOTIFICATION)
  } catch {
    // Distinct from a send failure: there is no transport at all. yd-email owns filling this
    // in. Until it does, this line is the honest state of the world and the detector reads
    // it as `absent`, not as `ok` and not as `broken`.
    logger.error(
      `${MARKER} status=absent reason=no_notification_module ` +
        `— reset token generated for a customer and DISCARDED. No email was sent.`
    )
    return
  }

  try {
    await notification.createNotifications({
      to: identifier,
      channel,
      template: templateId,
      data: {
        // yd-email renders these. Names are the contract; changing one silently breaks the
        // email without breaking this file.
        reset_url: resetUrl,
        email: identifier,
        token_expires_minutes: Number(process.env.RESET_TOKEN_TTL_MINUTES || 15),
      },
    })
    logger.info(`${MARKER} status=ok template=${templateId} channel=${channel}`)
  } catch (e: any) {
    logger.error(
      `${MARKER} status=failed template=${templateId} channel=${channel} ` +
        `error=${e?.message ?? String(e)} — the customer received NOTHING and was told nothing.`
    )
  }
}

export const config: SubscriberConfig = {
  event: 'auth.password_reset',
}
