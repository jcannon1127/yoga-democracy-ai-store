import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'
import { listLegacyOrdersForCustomer } from '../../../../../lib/legacy-orders'

/**
 * The signed-in customer's SFCC order history.
 *
 * Separate from `GET /store/orders` because these are not Medusa orders and must not pretend
 * to be. The storefront merges the two lists for display; keeping them apart on the wire is
 * what lets the UI mark a legacy order as historical rather than offering returns and reorders
 * the platform cannot honour.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: 'Unauthorized', type: 'unauthorized' })
  }

  // The email comes from the CUSTOMER RECORD, never from the request. A caller-supplied email
  // here would be an order-history read primitive for any address.
  let email: string | null = null
  try {
    const customerService: any = req.scope.resolve(Modules.CUSTOMER)
    const customer = await customerService.retrieveCustomer(customerId)
    email = customer?.email ?? null
  } catch {
    email = null
  }

  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100)
  const offset = Number(req.query.offset ?? 0) || 0

  const { orders, count } = await listLegacyOrdersForCustomer(
    req.scope, customerId, email, limit, offset
  )
  return res.status(200).json({ orders, count, limit, offset })
}
