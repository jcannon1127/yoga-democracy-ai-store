import { retrieveOrder } from "@lib/data/orders"
import { retrieveCustomer } from "@lib/data/customer"
import OrderDetailsTemplate from "@modules/order/templates/order-details-template"
import { Metadata } from "next"
import { notFound } from "next/navigation"
import LoginTemplate from "@modules/account/templates/login-template"

type Props = {
  params: Promise<{ id: string }>
}

/**
 * One order, for the customer who placed it.
 *
 * ── WHY THIS PAGE CHECKS OWNERSHIP ITSELF ──────────────────────────────────────────────
 *
 * `GET /store/orders/:id` is UNAUTHENTICATED in Medusa 2.19 and does no customer scoping.
 * Read from the installed source: the matcher carries `validateAndTransformQuery` only, while
 * the sibling `/transfer/request` and `/transfer/cancel` matchers right below it DO carry
 * `authenticate("customer", …)`. The handler fetches by id with one filter (`is_draft_order:
 * false`) and never reads `req.auth_context`. Upstream left a TODO above it asking whether
 * authentication should be applied.
 *
 * Measured against a healthy backend on 2026-08-26, not inferred: a request carrying ONLY the
 * publishable key — which ships in the browser bundle — returned the order's email, full
 * shipping name, street address, city, postal code, items, SKUs and total. This page then
 * rendered all of it at HTTP 200 with no session.
 *
 * That is deliberate upstream for the GUEST confirmation page, which has its own route at
 * `/order/[id]/confirmed` and legitimately has no session to check. It is not defensible HERE:
 * this URL lives under `/account`, is linked only from the signed-in order list, and its
 * audience is by definition a customer who is signed in.
 *
 * So the order id stops being a bearer token for the order's PII. An order URL is emailed,
 * forwarded, screen-shared and kept in browser history, and nothing about it ever expires.
 *
 * The two failures are kept apart on purpose: not signed in offers the login form, and an
 * order that is not yours is `notFound()` — the same answer as an id that does not exist, so
 * this page cannot be used to test whether an order id is real.
 */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const customer = await retrieveCustomer().catch(() => null)
  const order = customer
    ? await retrieveOrder(params.id).catch(() => null)
    : null

  // A title is a leak too: "Order #47 | Yoga Democracy" on a stranger's order confirms both
  // that the id is real and what its number is.
  if (!order || order.customer_id !== customer?.id) {
    return { title: "Order", description: "View your order" }
  }

  return {
    title: `Order #${order.display_id}`,
    description: `View your order`,
  }
}

export default async function OrderDetailPage(props: Props) {
  const params = await props.params

  const customer = await retrieveCustomer().catch(() => null)
  if (!customer) {
    return <LoginTemplate />
  }

  const order = await retrieveOrder(params.id).catch(() => null)

  // Absent, or not this customer's — one answer for both.
  if (!order || order.customer_id !== customer.id) {
    notFound()
  }

  return <OrderDetailsTemplate order={order} />
}
