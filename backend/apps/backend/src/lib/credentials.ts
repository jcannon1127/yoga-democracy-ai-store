import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

/**
 * Credential operations for a customer who is ALREADY SIGNED IN.
 *
 * Medusa 2.19 has no route for either of these, and the reason is worth stating rather than
 * treating as an oversight:
 *
 *   - `POST /auth/:actor_type/:auth_provider/update` is the reset-password endpoint. Its
 *     middleware refuses any token without `purpose: "reset"` and a `jti`, so a session bearer
 *     token cannot drive it. That is correct, and it means "change my password while signed in"
 *     is simply absent, not merely undocumented.
 *   - `StoreUpdateCustomer` deliberately omits `email`. The email IS the login: it is the
 *     `entity_id` of the emailpass provider identity. Letting the customer route change
 *     `customer.email` alone would move the label and leave the credential behind.
 *
 * Both gaps were shipping as controls on the profile page that told the customer they had
 * worked. See the route files.
 */

export const EMAILPASS = process.env.AUTH_EMAILPASS_PROVIDER_ID || 'emailpass'

export type IdentityRef = {
  /** The provider identity's key. For emailpass this is the login email address. */
  entityId: string
  authIdentityId: string
}

/**
 * The signed-in customer's login identity, found through `auth_identity.app_metadata`.
 *
 * DELIBERATELY NOT `customer.email`. The two are kept in step by `POST /store/customers/me/email`
 * below, but an admin edit, a data fix or a partial import can separate them, and a lookup keyed
 * on the display email would then either fail confusingly or — far worse — find somebody else's
 * identity. `app_metadata.customer_id` is the id Medusa assigns when the account is claimed; it
 * is the join the platform itself trusts.
 *
 * This is the same rule that closed the account-takeover in the order-history route: join on
 * identifiers the system assigns, never on labels humans edit.
 */
export async function findLoginIdentity(
  scope: any,
  customerId: string
): Promise<IdentityRef | null> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const rows = await knex('provider_identity as pi')
    .join('auth_identity as ai', 'ai.id', 'pi.auth_identity_id')
    .where('pi.provider', EMAILPASS)
    .whereNull('pi.deleted_at')
    .whereNull('ai.deleted_at')
    .whereRaw("ai.app_metadata->>'customer_id' = ?", [customerId])
    .select('pi.entity_id as entity_id', 'pi.auth_identity_id as auth_identity_id')

  // More than one identity for one customer is not a case to guess at. Returning null makes the
  // caller answer "could not determine" instead of silently picking one and changing the
  // password on whichever row came back first.
  if (rows.length !== 1) return null
  return { entityId: rows[0].entity_id, authIdentityId: rows[0].auth_identity_id }
}

/**
 * Does `password` currently sign this identity in?
 *
 * Runs the provider's own `authenticate`, so it uses the same scrypt verification as the login
 * form rather than a second implementation that could drift from it.
 *
 * NOTE ON MIGRATED CUSTOMERS: the 115,858 imported accounts carry an identity with no `password`
 * key at all, and `authenticate()` only calls scrypt.verify when one is present. Such an account
 * therefore fails here — which is right, because it also cannot sign in, so it can never reach a
 * route that calls this.
 */
export async function passwordMatches(
  scope: any,
  entityId: string,
  password: string
): Promise<boolean> {
  const auth: any = scope.resolve(Modules.AUTH)
  const result = await auth.authenticate(EMAILPASS, {
    body: { email: entityId, password },
  })
  return result?.success === true
}

/** True when some identity already owns this address — ours or anyone's. */
export async function identityExistsFor(scope: any, email: string): Promise<boolean> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const row = await knex('provider_identity')
    .where('provider', EMAILPASS)
    .whereNull('deleted_at')
    .whereRaw('lower(entity_id) = ?', [email])
    .first('id')
  return !!row
}

/** True when some customer record already carries this address. */
export async function customerExistsFor(
  scope: any,
  email: string,
  exceptCustomerId: string
): Promise<boolean> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const row = await knex('customer')
    .whereNull('deleted_at')
    .whereRaw('lower(email) = ?', [email])
    .andWhereNot('id', exceptCustomerId)
    .first('id')
  return !!row
}

/**
 * Move a customer's email AND their login to a new address, or move neither.
 *
 * THREE THINGS HAVE TO HAPPEN TOGETHER, and each one alone is a defect:
 *
 *   1. `customer.email` — the label shown on the account page and used on new orders.
 *   2. `provider_identity.entity_id` — the actual login. Without this the customer is told
 *      their email changed and can then only sign in with the old one.
 *   3. Any outstanding rows in `auth_password_reset_token` for the OLD address are deleted.
 *      A reset link already sitting in the old mailbox would otherwise still set a password on
 *      an account that no longer answers to that address — which is precisely the takeover the
 *      email change might have been made to escape.
 *
 * `order.email` and `legacy_order.email` are NOT touched, and that is deliberate: they record
 * the address the order was placed with, which is history and should not be rewritten. It does
 * mean guest tracking for an old order still wants the old address, which is correct.
 */
export async function moveEmail(
  scope: any,
  customerId: string,
  identity: IdentityRef,
  newEmail: string
): Promise<void> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await knex.transaction(async (trx: any) => {
    await trx('customer')
      .where('id', customerId)
      .update({ email: newEmail, updated_at: new Date() })
    await trx('provider_identity')
      .where('auth_identity_id', identity.authIdentityId)
      .andWhere('provider', EMAILPASS)
      .update({ entity_id: newEmail, updated_at: new Date() })
    await trx('auth_password_reset_token')
      .where('auth_identity_id', identity.authIdentityId)
      .del()
  })
}

/**
 * Kill every outstanding reset link for this identity.
 *
 * Called after a password change as well as an email change. A customer who has just set a new
 * password may well be doing it BECAUSE they think someone else has a link; leaving that link
 * live would make the change cosmetic.
 *
 * Keyed on `auth_identity_id` rather than the address, so it still finds the tokens after the
 * address has moved.
 */
export async function revokeResetTokens(scope: any, authIdentityId: string): Promise<number> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  return knex('auth_password_reset_token').where('auth_identity_id', authIdentityId).del()
}
