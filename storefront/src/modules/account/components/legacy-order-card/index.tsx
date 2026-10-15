import { convertToLocale } from "@lib/util/money"
import type { LegacyOrder } from "@lib/data/legacy-orders"

/**
 * One historical (pre-Medusa) order.
 *
 * Visibly marked as historical, and deliberately WITHOUT the "See details", return or exchange
 * actions a live order gets. SFCC's shipment records cannot be joined to order lines, so there
 * is no honest per-parcel state to show, and none of those actions would work against an order
 * the new platform cannot act on. Offering a button that fails is worse than not offering it.
 */
// How many lines show before the disclosure. Four fills the grid at every width swept.
const PREVIEW_ITEMS = 4

const LegacyLine = ({
  item,
  money,
}: {
  item: LegacyOrder["items"][number]
  money: (amount: number | null) => string
}) => (
  <div className="flex flex-col gap-y-1">
    <span className="text-small-regular">{item.title ?? "Item"}</span>
    <span className="text-xsmall-regular text-ui-fg-subtle">
      {item.sku ? `${item.sku} · ` : ""}
      {item.quantity ?? 0} × {money(item.unit_price)}
    </span>
  </div>
)

const LegacyOrderCard = ({ order }: { order: LegacyOrder }) => {
  const units = order.items.reduce((a, i) => a + (i.quantity ?? 0), 0)
  const money = (amount: number | null) =>
    amount === null
      ? "—"
      : convertToLocale({ amount, currency_code: order.currency_code })

  return (
    <div className="bg-white flex flex-col" data-testid="legacy-order-card">
      <div className="flex items-baseline gap-x-3 mb-1">
        <span className="uppercase text-large-semi">
          #<span data-testid="legacy-order-number">{order.order_number}</span>
        </span>
        <span className="text-xsmall-regular uppercase tracking-wide text-ui-fg-subtle border border-gray-300 rounded px-2 py-0.5">
          Previous order
        </span>
      </div>

      <div className="flex items-center divide-x divide-gray-200 text-small-regular text-ui-fg-base">
        <span className="pr-2">
          {order.placed_at ? new Date(order.placed_at).toDateString() : "Date unknown"}
        </span>
        <span className="px-2">{money(order.total)}</span>
        <span className="pl-2">
          {units} {units === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="grid grid-cols-2 small:grid-cols-4 gap-4 my-4">
        {order.items.slice(0, PREVIEW_ITEMS).map((i, idx) => (
          <LegacyLine key={idx} item={i} money={money} />
        ))}
      </div>

      {/*
        THE REST OF THE ORDER, REACHABLE.

        This read "+ N more" and stopped -- a dead label, not a control. 15,145 of 120,782
        migrated orders (12.5%) carry more than four lines, so one order in eight showed a
        customer a count of items they could not get to. The data was always in the response;
        only the rendering stopped at four.

        `<details>` rather than a client component on purpose: this card is a server component
        inside a list that can hold fifty of them, and the whole interaction is "show the rest".
        It works before hydration and it is keyboard- and screen-reader-navigable for free.
      */}
      {order.items.length > PREVIEW_ITEMS && (
        <details className="my-1" data-testid="legacy-order-more">
          <summary
            className="inline-flex items-center min-h-[44px] cursor-pointer text-small-regular underline"
            data-testid="legacy-order-more-summary"
          >
            Show the other {order.items.length - PREVIEW_ITEMS}{" "}
            {order.items.length - PREVIEW_ITEMS === 1 ? "item" : "items"}
          </summary>
          <div className="grid grid-cols-2 small:grid-cols-4 gap-4 mt-4">
            {order.items.slice(PREVIEW_ITEMS).map((i, idx) => (
              <LegacyLine key={idx} item={i} money={money} />
            ))}
          </div>
        </details>
      )}

      <p className="text-xsmall-regular text-ui-fg-subtle mt-2">
        Placed on our previous website. Tracking is no longer available for these
        orders — contact us if you need help with one.
      </p>
    </div>
  )
}

export default LegacyOrderCard
