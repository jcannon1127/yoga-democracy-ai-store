import { Button } from "@medusajs/ui"
import { useMemo } from "react"

import Thumbnail from "@modules/products/components/thumbnail"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"

type OrderCardProps = {
  order: HttpTypes.StoreOrder
}

const OrderCard = ({ order }: OrderCardProps) => {
  const numberOfLines = useMemo(() => {
    return (
      order.items?.reduce((acc, item) => {
        return acc + item.quantity
      }, 0) ?? 0
    )
  }, [order])

  const numberOfProducts = useMemo(() => {
    return order.items?.length ?? 0
  }, [order])

  // A CANCELLED ORDER RENDERED IDENTICALLY TO A LIVE ONE.
  //
  // The starter's card shows a number, a date, a total and the items, and NOTHING about status.
  // Proven on 2026-08-26 against a real cancelled order: two cards for one live order, visually
  // indistinguishable. A customer reading that sees a purchase with items and a total and has
  // every reason to think it is on its way -- the card is a receipt for something that is not
  // coming.
  //
  // Only states the customer would be misled by are labelled. A normal order gets no badge,
  // because a badge on every card is noise and stops being read.
  const flag =
    order.status === "canceled"
      ? "Cancelled"
      : order.status === "requires_action"
      ? "Needs attention"
      : null

  return (
    <div className="bg-white flex flex-col" data-testid="order-card">
      <div className="flex items-baseline gap-x-3 mb-1">
        <span className="uppercase text-large-semi">
          #<span data-testid="order-display-id">{order.display_id}</span>
        </span>
        {flag && (
          <span
            className="text-xsmall-regular uppercase tracking-wide text-ui-fg-subtle border border-gray-300 rounded px-2 py-0.5"
            data-testid="order-status-flag"
          >
            {flag}
          </span>
        )}
      </div>
      <div className="flex items-center divide-x divide-gray-200 text-small-regular text-ui-fg-base">
        <span className="pr-2" data-testid="order-created-at">
          {new Date(order.created_at).toDateString()}
        </span>
        <span className="px-2" data-testid="order-amount">
          {convertToLocale({
            amount: order.total,
            currency_code: order.currency_code,
          })}
        </span>
        <span className="pl-2">{`${numberOfLines} ${
          numberOfLines > 1 ? "items" : "item"
        }`}</span>
      </div>
      <div className="grid grid-cols-2 small:grid-cols-4 gap-4 my-4">
        {order.items?.slice(0, 3).map((i) => {
          return (
            <div
              key={i.id}
              className="flex flex-col gap-y-2"
              data-testid="order-item"
            >
              <Thumbnail thumbnail={i.thumbnail} images={[]} size="full" />
              <div className="flex items-center text-small-regular text-ui-fg-base">
                <span
                  className="text-ui-fg-base font-semibold"
                  data-testid="item-title"
                >
                  {i.title}
                </span>
                <span className="ml-2">x</span>
                <span data-testid="item-quantity">{i.quantity}</span>
              </div>
            </div>
          )
        })}
        {numberOfProducts > 4 && (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <span className="text-small-regular text-ui-fg-base">
              + {numberOfLines - 4}
            </span>
            <span className="text-small-regular text-ui-fg-base">more</span>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <LocalizedClientLink href={`/account/orders/details/${order.id}`}>
          <Button data-testid="order-details-link" variant="secondary">
            See details
          </Button>
        </LocalizedClientLink>
      </div>
    </div>
  )
}

export default OrderCard
