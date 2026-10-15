import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

/**
 * Create (or remove) a throwaway order so guest order tracking can be PROVEN to succeed, not
 * just proven to fail.
 *
 * The lookup route's failure paths are easy to test against an empty database — and testing
 * only those is how you ship a route that returns 404 to everyone. There are currently 0 rows
 * in `order`, so without a fixture the only honest verdict on the happy path is "unverified".
 *
 *   npx medusa exec ./src/scripts/accounts-test-order.ts
 *   npx medusa exec ./src/scripts/accounts-test-order.ts -- --remove
 *
 * The email is `.invalid` (RFC 2606 — can never be delivered to a real person) and the legacy
 * order number is deliberately unlike YD's real `PROD…` series.
 */

const EMAIL = 'yd-accounts-fixture@example.invalid'
const LEGACY_NUMBER = 'TESTPROD00000042'
const POSTAL = '46220'

export default async function accountsTestOrder({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderService: any = container.resolve(Modules.ORDER)

  const existing = await orderService.listOrders({ email: EMAIL })

  if (args?.includes('--remove')) {
    for (const o of existing) {
      await orderService.deleteOrders(o.id)
      logger.info(`removed fixture order ${o.id}`)
    }
    if (!existing.length) logger.info('no fixture order to remove')
    return
  }

  if (existing.length) {
    logger.info(
      `fixture already present: id=${existing[0].id} display_id=${existing[0].display_id}`
    )
    return
  }

  const [order] = await orderService.createOrders([
    {
      email: EMAIL,
      currency_code: 'usd',
      region_id: undefined,
      metadata: { legacy_order_number: LEGACY_NUMBER, fixture: 'yd-accounts' },
      shipping_address: {
        first_name: 'Fixture',
        last_name: 'Customer',
        address_1: '1 Test Street',
        city: 'Indianapolis',
        province: 'IN',
        postal_code: POSTAL,
        country_code: 'us',
      },
      items: [
        {
          title: 'Fixture Legging',
          variant_title: 'M / Standard (28")',
          quantity: 1,
          unit_price: 8800,
        },
      ],
    },
  ])

  logger.info(
    `created fixture order id=${order.id} display_id=${order.display_id} ` +
      `legacy=${LEGACY_NUMBER} email=${EMAIL} postal=${POSTAL}`
  )
}
