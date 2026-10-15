import { retrieveOrder } from "@lib/data/orders"
import OrderCompletedTemplate from "@modules/order/templates/order-completed-template"
import { Metadata } from "next"
import { notFound } from "next/navigation"

type Props = {
  params: Promise<{ id: string }>
}
export const metadata: Metadata = {
  // Indexing must be refused BY THIS ROUTE, not only by the preview-wide noindex in the root
  // layout. That site-wide flag exists because this is a private preview and it comes off at
  // launch — and on that day every page that relied on it becomes indexable. This page is
  // reachable with no authentication: Medusa 2.19 has no `authenticate` middleware on
  // GET /store/orders/:id, so an unguessable ULID is the only protection. An order page in a
  // search index is a customer's name, address and purchase history, published.
  robots: { index: false, follow: false, nocache: true },

  title: "Order Confirmed",
  description: "You purchase was successful",
}

export default async function OrderConfirmedPage(props: Props) {
  const params = await props.params
  const order = await retrieveOrder(params.id).catch(() => null)

  if (!order) {
    return notFound()
  }

  return <OrderCompletedTemplate order={order} />
}
