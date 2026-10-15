import { Metadata } from "next"

import OrderOverview from "@modules/account/components/order-overview"
import { notFound } from "next/navigation"
import LoginTemplate from "@modules/account/templates/login-template"
import { retrieveCustomer } from "@lib/data/customer"
import { listOrders } from "@lib/data/orders"
import { listLegacyOrders } from "@lib/data/legacy-orders"
import LegacyOrderCard from "@modules/account/components/legacy-order-card"
import { orderHelpContent, buildOrderHelpMailto } from "@lib/util/order-help"
import Divider from "@modules/common/components/divider"
import TransferRequestForm from "@modules/account/components/transfer-request-form"

export const metadata: Metadata = {
  title: "Orders",
  description: "Overview of your previous orders.",
}

// One page of history. The backend caps `limit` at 100, so this must stay at or under it --
// asking for more silently gets 100 back and the "showing X of Y" line below would then be
// wrong in the one place it exists to be right.
//
// Configurable ONLY so the truncation paths can be exercised. No customer has more than 12
// native orders today and the most historical is 98, so at 50 the "showing your N most recent"
// notice would never render in any test -- untested code on a page whose entire purpose is not
// to show part of a set silently. Set YD_ACCOUNT_PAGE_SIZE=5 against a test build to drive it.
const PAGE_SIZE = Math.min(
  Math.max(1, Number(process.env.YD_ACCOUNT_PAGE_SIZE) || 50),
  100
)

export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  /**
   * SIGNED OUT, THIS SAID THE PAGE DOES NOT EXIST.
   *
   * The customer check comes FIRST and is separate from the data check, because they are
   * different answers. A signed-out visitor following a bookmark to their orders was told the
   * page was gone -- so they go hunting a broken link instead of signing in -- and it rendered
   * inside the account layout at HTTP 200, which is a soft-404. `/account` already branched to
   * the login form; these pages did not, so the account area disagreed with itself depending
   * which URL you arrived at.
   *
   * `notFound()` still stands for a genuinely unreadable order list below. "You are not signed
   * in" and "your orders could not be loaded" must not collapse into one answer -- that is the
   * same absent-versus-unreadable distinction the legacy list already makes.
   */
  const customer = await retrieveCustomer().catch(() => null)
  if (!customer) {
    return <LoginTemplate />
  }

  const live = await listOrders(PAGE_SIZE, 0)

  if (!live) {
    notFound()
  }
  const orders = live.orders

  // 1-based in the URL because it is a thing a customer can see and edit. Anything unparseable
  // or out of range becomes page 1 rather than an error or an empty list.
  const requestedPage = Math.max(1, Number((await searchParams)?.page) || 1)

  // YD has 120,783 orders of history and, today, zero native Medusa orders. A returning
  // customer who signs in and is told "Nothing to see here" against eleven years of purchases
  // is the failure this lane was warned about by name: the account works, the login works, and
  // the history is empty with nothing erroring anywhere.
  const legacy = await listLegacyOrders(PAGE_SIZE, (requestedPage - 1) * PAGE_SIZE)

  return (
    <div className="w-full" data-testid="orders-page-wrapper">
      <div className="mb-8 flex flex-col gap-y-4">
        <h1 className="text-2xl-semi">Orders</h1>
        {/*
          The starter copy promised "you can also create returns or exchanges" here. YD has no
          returns portal — it is one of the capabilities the footer advertises and the platform
          does not have — and none of these historical orders could support one anyway. A page
          that offers a customer something the site cannot do turns into a support email.
        */}
        <p className="text-base-regular">
          View your orders and what was in them. Need to return or exchange
          something? Get in touch and we will sort it out.
        </p>
      </div>
      <div>
        {/* Live orders first: someone checking on a recent purchase is the common case. */}
        {orders.length > 0 && (
          <>
            <OrderOverview orders={orders} />
            {/*
              THE SAME DEFECT THE LEGACY LIST HAD, ONE COMPONENT OVER.

              `listOrders()` defaults to a limit of 10 and the starter threw the response's
              `count` away, so the page could not have known more existed even in principle.
              Proven against a real customer with 12 orders: ten rendered, two absent, no pager,
              nothing wrong on the page.

              A link rather than a slice: native orders are still few, and sending someone to a
              full list is honest and cheap. What must never happen again is the page showing
              part of a set and saying nothing.
            */}
            {live.count > orders.length && (
              <p
                className="mt-6 text-base-regular text-ui-fg-subtle"
                data-testid="live-orders-truncated"
              >
                Showing your {orders.length} most recent orders of {live.count}.
              </p>
            )}
          </>
        )}

        {/*
          THREE STATES, NOT TWO. `null` means the history could not be READ; an empty list
          means there genuinely is none. Collapsing them would tell a customer with forty
          orders that they have none because a query failed — and send them to customer
          service certain their account is broken.
        */}
        {legacy === null ? (
          <div className="mt-8 border border-gray-200 rounded-md p-6">
            <h2 className="text-large-semi mb-1">
              We could not load your previous orders
            </h2>
            <p className="text-base-regular text-ui-fg-subtle">
              This is a problem on our side, not a sign that your orders are
              missing. Please refresh in a moment, or contact us and we will look
              them up for you.
            </p>
          </div>
        ) : legacy.orders.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-large-semi mb-1">Previous orders</h2>
            {/*
              THE HEADLINE USED TO NAME A TOTAL THE PAGE DID NOT RENDER.

              It printed `legacy.count` -- the full number -- above a list hard-capped at 50
              with no way to reach the rest. YD's most frequent customer has 98 orders, and
              nine customers have more than 50, so those people were told "98 orders placed on
              our previous website" and shown fifty. Small population, but it is the same
              defect this lane keeps finding: a number that is true of the data and false about
              what is on the screen.

              Now it either states the total plainly (when the total IS on screen) or says
              which slice of it this is.
            */}
            <p className="text-base-regular text-ui-fg-subtle mb-6">
              {legacy.count > legacy.orders.length ? (
                <>
                  Showing {(requestedPage - 1) * PAGE_SIZE + 1}–
                  {(requestedPage - 1) * PAGE_SIZE + legacy.orders.length} of{" "}
                  {legacy.count} orders placed on our previous website.
                </>
              ) : (
                <>
                  {legacy.count} {legacy.count === 1 ? "order" : "orders"} placed on
                  our previous website.
                </>
              )}
            </p>
            <div className="flex flex-col gap-y-8 w-full">
              {legacy.orders.map((o) => (
                <div
                  key={o.id}
                  className="border-b border-gray-200 pb-6 last:pb-0 last:border-none"
                >
                  <LegacyOrderCard order={o} />
                </div>
              ))}
            </div>

            {/*
              Plain links, not a client component: this page is server-rendered and paging is a
              navigation, so it works with JavaScript off and each page is a real shareable URL.
            */}
            {legacy.count > PAGE_SIZE && (
              <div
                className="mt-8 flex items-center gap-x-6"
                data-testid="legacy-orders-pagination"
              >
                {requestedPage > 1 && (
                  <a
                    href={`?page=${requestedPage - 1}`}
                    className="inline-flex items-center min-h-[44px] underline text-small-regular"
                    data-testid="legacy-orders-prev"
                  >
                    Newer orders
                  </a>
                )}
                {(requestedPage - 1) * PAGE_SIZE + legacy.orders.length <
                  legacy.count && (
                  <a
                    href={`?page=${requestedPage + 1}`}
                    className="inline-flex items-center min-h-[44px] underline text-small-regular"
                    data-testid="legacy-orders-next"
                  >
                    Older orders
                  </a>
                )}
              </div>
            )}

            {/*
              THE SAME GAP, SEEN FROM THE OTHER SIDE.

              8,984 migrated orders carry no email anywhere in the export, so they attach to no
              customer and appear in nobody's history. From the customer's chair that is not an
              error — it is an order they remember placing that simply is not on this list, with
              nothing on the page acknowledging it could happen. They would reasonably conclude
              the account is wrong.

              Shown to EVERY signed-in customer, not only those with a known gap: which orders
              are missing is exactly the thing that must not be disclosed, and a customer whose
              history is complete loses nothing by reading one extra line.
            */}
            <div className="mt-10 border-t border-gray-200 pt-6 flex flex-col gap-y-2">
              <span className="text-base-semi">
                {orderHelpContent.history_incomplete.heading}
              </span>
              <span className="text-small-regular text-ui-fg-subtle">
                {orderHelpContent.history_incomplete.body}
              </span>
              <a
                href={buildOrderHelpMailto()}
                className="inline-flex items-center min-h-[44px] underline text-small-regular"
                data-testid="history-help-link"
              >
                {orderHelpContent.lookup_failed.cta}
              </a>
            </div>
          </div>
        ) : orders.length === 0 ? (
          <OrderOverview orders={orders} />
        ) : null}

        <Divider className="my-16" />
        <TransferRequestForm />
      </div>
    </div>
  )
}
