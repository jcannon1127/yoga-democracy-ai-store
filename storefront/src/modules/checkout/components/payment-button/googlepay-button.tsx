"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { loadGooglePaySdk, loadPaypalSdk } from "./paypal-sdk"
import { customerMessage, isRedirectSignal } from "./payment-errors"

/**
 * Google Pay, through PayPal.
 *
 * It is a FUNDING SOURCE ON THE PAYPAL ORDER THE PROVIDER ALREADY CREATED, not a
 * second provider and not a second order. `confirmOrder` confirms the payment
 * source on that same order id; the server then captures it exactly as it does
 * for the PayPal button. So this needs no backend change -- verified against a
 * live session, not assumed:
 *
 *     paypal order 9V505064PY647912U   eligible true   isReadyToPay true
 *     charging 20.00 USD FINAL         gateway "paypalsb"
 *
 * WHAT IS NOT PROVEN: the purchase. `loadPaymentData()` redirects to
 * accounts.google.com -- Google Pay requires a signed-in Google account even in
 * TEST environment. Measured on 2026-08-25, not assumed. Nobody can complete a
 * Google Pay purchase from a headless machine, so the last rung needs a human
 * with a signed-in browser. `payments/browser-test/googlepay_probe.py` walks
 * everything up to that line.
 */

type Props = {
  cart: HttpTypes.StoreCart
  /** Called after Google Pay confirms. Should complete the cart. */
  onApproved: () => void | Promise<void>
  onError?: (message: string) => void
  disabled?: boolean
}

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
// TEST until someone decides otherwise. Google Pay's PRODUCTION environment
// requires a registered merchant origin, so flipping this without registering
// the domain gives a button that fails at the sheet for real customers.
const GP_ENV = process.env.NEXT_PUBLIC_GOOGLE_PAY_ENV === "PRODUCTION" ? "PRODUCTION" : "TEST"

function paypalOrderId(cart: HttpTypes.StoreCart): string | null {
  const s = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending" && s.provider_id?.startsWith("pp_paypal")
  )
  const id = (s?.data as { id?: string } | undefined)?.id
  // "FREE_ORDER" is the provider's synthetic session for a zero-total basket --
  // PayPal refuses a $0 order, so no real PayPal order exists to confirm against.
  // A wallet offered here would take the customer through a sheet and then fail.
  // Zero-total baskets are a real, recurring flow (a Yotpo reward capped to a
  // small sale basket settles whole orders at $0.00), not an abuse case.
  return id && id !== "FREE_ORDER" ? id : null
}

export default function GooglePayButton({ cart, onApproved, onError, disabled }: Props) {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)

  const fail = useCallback(
    (message: string) => {
      setError(message)
      onError?.(message)
    },
    [onError]
  )

  useEffect(() => {
    if (mounted.current) return
    const orderId = paypalOrderId(cart)
    if (!orderId || !CLIENT_ID) {
      // No PayPal order means there is nothing for Google Pay to confirm. Say so
      // rather than rendering a button that fails on press.
      fail("Google Pay is unavailable right now.")
      return
    }

    let cancelled = false
    const currency = (cart.currency_code || "usd").toUpperCase()
    // `total` is what the customer is shown and what the cart guard checked.
    // Anything else here charges a different number than the one on screen.
    const total = Number(cart.total ?? 0).toFixed(2)

    // BOTH go through the shared loaders. A second PayPal script tag with a
    // different `components=` list silently killed the PayPal button once; see
    // paypal-sdk.ts.
    Promise.all([loadGooglePaySdk(), loadPaypalSdk(currency)])
      .then(async () => {
        if (cancelled || !container.current) return
        const paypal = (window as any).paypal
        const google = (window as any).google
        if (!paypal?.Googlepay || !google?.payments?.api) {
          throw new Error("Google Pay failed to initialise.")
        }

        const gp = paypal.Googlepay()
        const cfg = await gp.config()
        if (!cfg?.isEligible) {
          // Not an error the customer caused, and not worth a red message --
          // just do not offer a method that cannot work. But SAY SO somewhere:
          // an early return with no trace is why this took two hours to notice.
          // eslint-disable-next-line no-console
          console.warn("[yd-googlepay] merchant not eligible; not offering Google Pay")
          return
        }

        const client = new google.payments.api.PaymentsClient({ environment: GP_ENV })
        const request = {
          apiVersion: cfg.apiVersion,
          apiVersionMinor: cfg.apiVersionMinor,
          allowedPaymentMethods: cfg.allowedPaymentMethods,
          merchantInfo: cfg.merchantInfo,
          transactionInfo: {
            countryCode: cfg.countryCode || "US",
            currencyCode: currency,
            totalPriceStatus: "FINAL",
            totalPrice: total,
          },
          emailRequired: true,
          // The cart already has a shipping address and a chosen method. Asking
          // Google for one again invites a second, different address onto an
          // order that has already been priced and rated for the first.
          shippingAddressRequired: false,
        }

        const { result } = await client.isReadyToPay({
          apiVersion: request.apiVersion,
          apiVersionMinor: request.apiVersionMinor,
          allowedPaymentMethods: request.allowedPaymentMethods,
        })
        if (!result) {
          // eslint-disable-next-line no-console
          console.warn("[yd-googlepay] isReadyToPay false; not offering Google Pay")
          return
        }
        if (cancelled || !container.current) return

        const button = client.createButton({
          buttonColor: "black",
          buttonType: "pay",
          buttonSizeMode: "fill",
          onClick: async () => {
            setBusy(true)
            setError(null)
            try {
              const data = await client.loadPaymentData(request)
              const res = await gp.confirmOrder({
                orderId,
                paymentMethodData: data.paymentMethodData,
              })
              if (res?.status && res.status !== "APPROVED" && res.status !== "COMPLETED") {
                throw new Error("Google Pay could not confirm this payment.")
              }
              await onApproved()
            } catch (e: any) {
              // Two things that are NOT failures: the customer closing the sheet
              // (statusCode CANCELED), and Next's redirect, which is how a
              // SUCCESSFUL payment leaves this page.
              if (e?.statusCode === "CANCELED" || isRedirectSignal(e)) {
                setError(null)
              } else {
                fail(customerMessage(e))
              }
            } finally {
              setBusy(false)
            }
          },
        })
        container.current.appendChild(button)
        mounted.current = true
        setReady(true)
      })
      .catch((e: Error) => {
        // LOG IT. A wallet that disappears with no trace is indistinguishable
        // from one that was never offered.
        //
        // 2026-08-26: Google Pay was absent from the DEPLOYED checkout while the
        // identical component rendered it standalone minutes apart, same PayPal
        // app, same machine. `Googlepay().config()` was throwing NetworkError on
        // that page. Nothing in the console said so, because this handler stayed
        // quiet on the reasoning that "an unavailable wallet is not a
        // customer-facing failure". That is true for the CUSTOMER and false for
        // everyone trying to find out why a wallet vanished.
        // eslint-disable-next-line no-console
        console.error("[yd-googlepay] not offered:", e?.message || e)
        if (!cancelled) fail(e.message || "Google Pay failed to load.")
      })

    return () => {
      cancelled = true
    }
    // Keyed on the payment session, like the PayPal button: re-rendering on every
    // cart change would tear the button down mid-sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.payment_collection?.id])

  // THE CONTAINER IS ALWAYS MOUNTED, and that is not a style choice.
  //
  // The first version returned null until `ready`, and `ready` was only set after
  // appending the button to `container.current` -- which never existed, because
  // the component was returning null. It rendered nothing, threw nothing, and
  // logged nothing. It took a DOM dump at the review step to see that both SDKs
  // had loaded fine and the effect had simply bailed on a null ref.
  //
  // So the node stays in the tree and is hidden until there is a button in it.
  // An unavailable wallet still shows nothing to the customer.
  return (
    <div className={`flex flex-col gap-y-2 ${!ready && !error ? "hidden" : ""}`}>
      <div
        ref={container}
        aria-busy={busy}
        className={disabled || busy ? "pointer-events-none opacity-60" : undefined}
      />
      {busy && (
        <span className="text-ui-fg-subtle text-sm">
          Completing your order — please don&apos;t close this page.
        </span>
      )}
      {error && (
        <div role="alert" className="text-ui-fg-error text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
