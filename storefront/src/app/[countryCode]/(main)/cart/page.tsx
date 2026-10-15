import { retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import CartTemplate from "@modules/cart/templates"
import { Metadata } from "next"
import { notFound } from "next/navigation"

export const metadata: Metadata = {
  // Indexing must be refused BY THIS ROUTE, not only by the preview-wide noindex in the root
  // layout. That site-wide flag exists because this is a private preview and it comes off at
  // launch — and on that day every page that relied on it becomes indexable. This page is
  // reachable with no authentication: Medusa 2.19 has no `authenticate` middleware on
  // GET /store/orders/:id, so an unguessable ULID is the only protection. An order page in a
  // search index is a customer's name, address and purchase history, published.
  robots: { index: false, follow: false, nocache: true },

  title: "Cart",
  description: "View your cart",
}

export default async function Cart() {
  const cart = await retrieveCart().catch((error) => {
    console.error(error)
    return notFound()
  })

  const customer = await retrieveCustomer()

  return <CartTemplate cart={cart} customer={customer} />
}
