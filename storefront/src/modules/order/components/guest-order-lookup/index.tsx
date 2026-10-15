"use client"

import { useActionState, useState } from "react"
import Image from "next/image"
import { lookupGuestOrder } from "@lib/data/order-lookup"
import { convertToLocale } from "@lib/util/money"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { orderHelpContent, buildOrderHelpMailto } from "@lib/util/order-help"

/**
 * Guest order tracking.
 *
 * Why this page is worth building rather than deferring: YD has no returns portal, so customer
 * service is already the fallback for everything. Every guest who cannot find their own order
 * becomes an email a person has to answer. The live site has this today.
 */
const GuestOrderLookup = () => {
  const [state, formAction] = useActionState(lookupGuestOrder, null)
  // What the customer typed, kept so the "email us" link can carry it. Read from the form on
  // submit rather than controlled inputs — the fields stay uncontrolled, which is how the rest
  // of this form already works.
  const [lastTried, setLastTried] = useState<{
    order_number?: string
    email?: string
  }>({})

  const money = (amount: number | null, currency_code: string) =>
    amount === null ? "—" : convertToLocale({ amount, currency_code })

  return (
    <div className="w-full max-w-3xl flex flex-col gap-y-10">
      <div className="flex flex-col gap-y-4">
        <h1 className="text-2xl-semi">Track your order</h1>
        <p className="text-base-regular">
          Enter your order number, the email address you used, and the postal
          code on the order. You do not need an account.
        </p>
      </div>

      <form
        className="w-full max-w-sm"
        action={formAction}
        onSubmit={(e) => {
          const f = new FormData(e.currentTarget)
          setLastTried({
            order_number: (f.get("order_number") as string) || undefined,
            email: (f.get("email") as string) || undefined,
          })
        }}
      >
        <div className="flex flex-col w-full gap-y-2">
          <Input
            label="Order number"
            name="order_number"
            type="text"
            required
            data-testid="track-order-number-input"
          />
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            data-testid="track-email-input"
          />
          <Input
            label="Postal code"
            name="postal_code"
            type="text"
            autoComplete="postal-code"
            required
            data-testid="track-postal-input"
          />
        </div>
        <ErrorMessage
          error={
            state && state.state !== "found" ? state.message : null
          }
          data-testid="track-error-message"
        />
        <SubmitButton className="w-full mt-6" data-testid="track-submit-button">
          Find my order
        </SubmitButton>

        {/*
          A WAY OUT, because for some customers there is no amount of retyping that will work.
          Of 120,783 historical orders, 9,662 have no postal code recorded and 8,984 carry no
          email address anywhere in the export — 11.6% that this page can never find, however
          correctly the customer fills the form in. Repeating "check your records and try
          again" at them is how a data gap becomes a person feeling stupid.

          Shown on EVERY not-found, never only for the unfindable ones: which orders are
          unfindable is exactly the thing this page must not disclose.
        */}
        {/*
          THE WAY OUT, AND THE ONE PLACE THE ENUMERATION RULE AND THE CUSTOMER PULL APART.

          A customer who mistyped and a customer whose order is permanently unfindable must see
          IDENTICAL words — telling them apart would tell a stranger which order numbers exist,
          and YD's are sequential. So the resolution is not a different message for the second
          person: it is that EVERYONE is offered a route to a human, every time.

          It is not a rare path. 8,984 migrated orders carry no email anywhere in the export and
          9,662 have no postal code — roughly 1 in 9 can never be found here, no matter how
          carefully the form is filled in. That is eleven-year-old data, not a bug, and it is
          permanent.

          The mailto is prefilled from what the customer typed into THIS form and nothing else,
          which is what keeps it compatible with the rule above: it is the same shape whether or
          not the order exists, because it knows nothing about the order. Wording lives in
          src/content/order-help.json so the merchandising team can rewrite it without a code change.
        */}
        {state?.state === "not_found" && (
          <div
            className="mt-6 border border-gray-200 rounded-md p-4 flex flex-col gap-y-2"
            data-testid="track-contact-fallback"
          >
            <span className="text-base-semi">
              {orderHelpContent.lookup_failed.heading}
            </span>
            <span className="text-small-regular text-ui-fg-subtle">
              {orderHelpContent.lookup_failed.body}
            </span>
            <a
              href={buildOrderHelpMailto({
                orderNumber: lastTried.order_number,
                email: lastTried.email,
              })}
              className="inline-flex items-center min-h-[44px] underline text-small-regular"
              data-testid="track-contact-link"
            >
              {orderHelpContent.lookup_failed.cta}
            </a>
          </div>
        )}
      </form>

      {state?.state === "found" && (
        <div
          className="flex flex-col gap-y-6 border-t border-gray-200 pt-8"
          data-testid="track-order-result"
        >
          <div className="flex flex-col gap-y-1">
            <h2 className="text-xl-semi">
              Order {state.order.order_number ?? ""}
            </h2>
            <span className="text-small-regular text-ui-fg-subtle">
              Placed{" "}
              {new Date(state.order.placed_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "America/New_York",
              })}{" "}
              · {state.order.status}
            </span>
          </div>

          <div className="flex flex-col gap-y-4">
            {state.order.items.map((item, i) => (
              <div key={i} className="flex gap-x-4 items-center">
                {item.thumbnail ? (
                  <Image
                    src={item.thumbnail}
                    alt={item.title}
                    width={64}
                    height={80}
                    className="object-cover rounded"
                  />
                ) : (
                  <div className="w-16 h-20 bg-gray-100 rounded" />
                )}
                <div className="flex flex-col">
                  <span className="text-base-regular">{item.title}</span>
                  {item.variant_title && (
                    <span className="text-small-regular text-ui-fg-subtle">
                      {item.variant_title}
                    </span>
                  )}
                  <span className="text-small-regular text-ui-fg-subtle">
                    Qty {item.quantity} ·{" "}
                    {money(item.unit_price, state.order.currency_code)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/*
            Shipping is shown, not just folded into the total. Charge lines are filtered out of
            the item list (a "STANDARD SHIPPING" row reads as a second product), which left one
            $9.60 item above a $16.37 total and no explanation of the gap — an invitation to
            email and ask what the extra money was.
          */}
          <div className="flex flex-col gap-y-1 text-base-regular">
            {state.order.totals.subtotal !== null &&
              state.order.totals.subtotal !== state.order.totals.total && (
                <div className="flex justify-between text-ui-fg-subtle">
                  <span>Subtotal</span>
                  <span>
                    {money(state.order.totals.subtotal, state.order.currency_code)}
                  </span>
                </div>
              )}
            {!!state.order.totals.shipping && (
              <div className="flex justify-between text-ui-fg-subtle">
                <span>Shipping</span>
                <span>
                  {money(state.order.totals.shipping, state.order.currency_code)}
                </span>
              </div>
            )}
            {!!state.order.totals.tax && (
              <div className="flex justify-between text-ui-fg-subtle">
                <span>Tax</span>
                <span>{money(state.order.totals.tax, state.order.currency_code)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>
                {money(state.order.totals.total, state.order.currency_code)}
              </span>
            </div>
          </div>

          {/*
            Shipment state is the whole reason a customer comes to this page, so all four cases
            are said in words rather than left as an empty area.

            THE LEGACY CASE IS NOT "NOT SHIPPED" AND CONFLATING THEM WAS A REAL BUG HERE: the
            first version rendered a Fulfilled 2025 order with "This order has not shipped yet",
            because SFCC's shipment records cannot be joined to order lines and so `shipments`
            is ALWAYS empty for historical orders. An empty list means UNKNOWN on those, and
            telling a customer their delivered order never shipped is precisely the kind of
            confident wrong answer that generates the support email this page exists to prevent.
          */}
          <div className="flex flex-col gap-y-2 border-t border-gray-200 pt-6">
            <h3 className="text-base-semi">Shipping</h3>
            {state.order.is_legacy && state.order.shipments.length === 0 ? (
              <p className="text-base-regular text-ui-fg-subtle">
                This order was placed on our previous website, where we can no
                longer look up tracking.{" "}
                {state.order.status
                  ? `Its last recorded status was "${state.order.status}".`
                  : ""}{" "}
                Email us if you need help with it.
              </p>
            ) : state.order.shipments.length === 0 ? (
              <p className="text-base-regular text-ui-fg-subtle">
                This order has not shipped yet. You will get an email with
                tracking as soon as it does.
              </p>
            ) : (
              state.order.shipments.map((s, i) => (
                <div key={i} className="flex flex-col gap-y-1">
                  <span className="text-base-regular">
                    {s.delivered_at
                      ? "Delivered"
                      : s.shipped_at
                      ? "Shipped"
                      : "Preparing to ship"}
                  </span>
                  {s.tracking.length > 0 ? (
                    s.tracking.map((t, j) => (
                      <span key={j} className="text-small-regular">
                        {t.url ? (
                          <a
                            href={t.url}
                            className="underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.number ?? "Track this parcel"}
                          </a>
                        ) : (
                          t.number ?? "Tracking number pending"
                        )}
                      </span>
                    ))
                  ) : (
                    <span className="text-small-regular text-ui-fg-subtle">
                      Tracking number pending.
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {state.order.ship_to && (
            <div className="flex flex-col gap-y-1 border-t border-gray-200 pt-6">
              <h3 className="text-base-semi">Shipping to</h3>
              <span className="text-base-regular text-ui-fg-subtle">
                {[
                  state.order.ship_to.name,
                  state.order.ship_to.city,
                  state.order.ship_to.province,
                  state.order.ship_to.postal_code,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>
      )}

      <p className="text-small-regular text-ui-fg-subtle">
        Have an account?{" "}
        <LocalizedClientLink href="/account" className="underline">
          Sign in
        </LocalizedClientLink>{" "}
        to see all of your orders.
      </p>
    </div>
  )
}

export default GuestOrderLookup
