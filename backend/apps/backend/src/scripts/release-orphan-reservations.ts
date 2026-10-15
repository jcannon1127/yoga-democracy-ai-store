import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { cancelOrderWorkflow } from '@medusajs/medusa/core-flows'
import type { ExecArgs } from '@medusajs/framework/types'

/**
 * Release reservations and order line items left behind by test orders.
 *
 * WHY THIS EXISTS, AND IT IS A LESSON RATHER THAN A TOOL.
 *
 * I deleted five probe orders with `DELETE FROM "order"`. That cascades `order_item`, the link
 * table — and leaves `order_line_item` and `reservation_item` behind, because neither has a
 * foreign key to `order`. The result is stock held against a real product by orders that no
 * longer exist: five units of 1114XS194, invisible, with nothing erroring.
 *
 * It was very nearly diagnosed as a leak in the completion guard — the end state is identical
 * to what a guard that refuses without compensating would produce. It is not: three refusals
 * measured before-and-after created zero rows, and every refused cart has `completed_at` NULL.
 * The orphans came from my cleanup, not from a refusal.
 *
 * SO: NEVER DELETE AN ORDER WITH SQL. Cancel it through the workflow, which releases the
 * reservation. This script does that for anything still cancellable, and only falls back to
 * module-level deletes for rows whose order is already gone and which therefore cannot be
 * reached any other way.
 *
 *   npx medusa exec ./src/scripts/release-orphan-reservations.ts <probe-address>
 */
export default async function releaseOrphans({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const inventory: any = container.resolve(Modules.INVENTORY)

  // POSITIONAL, not a flag: `medusa exec` parses anything dash-prefixed as its own CLI option
  // and rejects it ("Unknown argument: email"). Passing the address bare is the working form.
  const email = (args ?? []).find((a) => a && !a.startsWith('-'))
  if (!email) {
    logger.error(
      'refusing to run without an email argument: this deletes data and must be scoped.\n' +
        '  npx medusa exec ./src/scripts/release-orphan-reservations.ts probe@example.invalid'
    )
    return
  }
  if (!email.includes('.invalid') && !email.includes('example.')) {
    // A real customer's order must never be cancelled by a cleanup script run from a terminal.
    logger.error(
      `refusing: ${email} is not an obviously non-deliverable test address. ` +
        'Cancel real orders through the admin, deliberately.'
    )
    return
  }

  // 1. Orders that still exist: cancel through the workflow so the reservation is released the
  //    way Medusa intends, rather than deleted underneath it.
  const { data: orders } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'email'],
    filters: { email } as any,
  })
  for (const o of orders ?? []) {
    try {
      await cancelOrderWorkflow(container).run({ input: { order_id: o.id } })
      logger.info(`cancelled ${o.id} through the workflow (reservation released)`)
    } catch (e: any) {
      logger.error(`could not cancel ${o.id}: ${e?.message ?? e}`)
    }
  }

  // 2. Rows whose order is already gone. There is no workflow that reaches these — the order
  //    they belonged to no longer exists — so the module API is the cleanest route left.
  const orphanLineItems: { id: string }[] = await knex('order_line_item')
    .select('order_line_item.id')
    .whereNotExists(function (this: any) {
      this.select(1).from('order_item').whereRaw('order_item.item_id = order_line_item.id')
    })
  const ids = orphanLineItems.map((r) => r.id)
  logger.info(`order line items with no order: ${ids.length}`)

  if (ids.length) {
    const stranded: { id: string }[] = await knex('reservation_item')
      .select('id')
      .whereIn('line_item_id', ids)
      .whereNull('deleted_at')
    if (stranded.length) {
      await inventory.deleteReservationItems(stranded.map((r) => r.id))
      logger.info(`released ${stranded.length} stranded reservation(s) via the inventory module`)
    }
    await knex('order_line_item').whereIn('id', ids).del()
    logger.info(`removed ${ids.length} orphaned order line item(s)`)
  }

  const remaining = await knex('reservation_item').whereNull('deleted_at').count({ c: '*' })
  logger.info(`reservations remaining: ${remaining[0].c}`)
}
