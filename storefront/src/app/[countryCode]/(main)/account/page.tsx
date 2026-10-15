import { Metadata } from "next"

import Overview from "@modules/account/components/overview"
import LoginTemplate from "@modules/account/templates/login-template"
import { retrieveCustomer } from "@lib/data/customer"
import { listOrders } from "@lib/data/orders"
import { STORE_NAME } from "@lib/constants/store"

/**
 * Account: signed-in overview, or the sign-in form.
 *
 * The starter split this across Next PARALLEL ROUTES — `@dashboard` and `@login` slots that
 * the layout chose between. On Next 15.3.9 that route returned 500 to every visitor:
 *
 *     TypeError: Cannot read properties of undefined (reading 'clientModules')
 *
 * The message names neither the route nor a file. It reproduced on two independently built
 * copies of the site, which ruled out a bad build; adding the `default.tsx` files that
 * parallel routes require did not fix it; and a layout rendering NO slots at all still 500'd.
 * That last test is what settled it — the fault is the parallel-route machinery itself, not
 * anything in the slots.
 *
 * So the slots are gone. One page, one branch on whether a customer is signed in. The
 * sub-routes (orders, profile, addresses) moved up out of the `@dashboard` slot and keep
 * their URLs exactly: /account/orders, /account/profile, /account/addresses.
 */
export const metadata: Metadata = {
  // Indexing must be refused BY THIS ROUTE, not only by the preview-wide noindex in the root
  // layout. That site-wide flag exists because this is a private preview and it comes off at
  // launch — and on that day every page that relied on it becomes indexable. This page is
  // reachable with no authentication: Medusa 2.19 has no `authenticate` middleware on
  // GET /store/orders/:id, so an unguessable ULID is the only protection. An order page in a
  // search index is a customer's name, address and purchase history, published.
  robots: { index: false, follow: false, nocache: true },

  title: "Account",
  description: `Manage your ${STORE_NAME} account.`,
}

export default async function AccountPage() {
  const customer = await retrieveCustomer().catch(() => null)

  if (!customer) {
    return <LoginTemplate />
  }

  // `.orders`: listOrders now returns { orders, count } so callers can tell a full set from a
  // truncated one. The overview only ever shows a handful, so it takes the list and ignores the
  // count deliberately.
  const orders = (await listOrders().catch(() => null))?.orders || null

  return <Overview customer={customer} orders={orders} />
}
