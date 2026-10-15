"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { loadPaypalSdk } from "./paypal-sdk"
import { customerMessage, isRedirectSignal } from "./payment-errors"

/**
 * Apple Pay, through PayPal.
 *
 * Same shape as the Google Pay button: a funding source on the PayPal order the
 * provider already created, confirmed with `confirmOrder`, captured server-side
 * by the existing path. No backend change.
 *
 * THREE THINGS THAT ARE TRUE OF APPLE PAY AND NOT OF ANY OTHER BUTTON HERE:
 *
 * 1. IT ONLY EXISTS IN SAFARI AND ON iOS. `window.ApplePaySession` is undefined
 *    everywhere else, so this component renders nothing in Chrome, Firefox or
 *    any headless browser. It was therefore NEVER RENDERED before being
 *    committed -- unlike the PayPal and Google Pay buttons, which were
 *    photographed. Someone with a Mac or an iPhone has to be the first to see it.
 *    Saying so here rather than letting a reader assume parity.
 *
 * 2. THE DOMAIN MUST BE REGISTERED WITH PAYPAL. Apple requires a domain
 *    association file served from the exact domain that shows the button.
 *    Registering the preview domain does NOT cover the launch domain: a button
 *    on an unregistered domain fails at merchant validation, which happens after
 *    the customer has already tapped. Whichever domain launches has to be
 *    registered before this ships.
 *
 * 3. MERCHANT VALIDATION IS A ROUND TRIP MID-GESTURE. `onvalidatemerchant` fires
 *    after the sheet opens; if it throws, the sheet dies in the customer's hand.
 *    So every failure below aborts the session explicitly rather than leaving a
 *    spinner on screen.
 */

type Props = {
  cart: HttpTypes.StoreCart
  onApproved: () => void | Promise<void>
  onError?: (message: string) => void
  disabled?: boolean
}

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
const DISPLAY_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "Yoga Democracy"

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

export default function ApplePayButton({ cart, onApproved, onError, disabled }: Props) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const config = useRef<any>(null)

  const fail = useCallback(
    (message: string) => {
      setError(message)
      onError?.(message)
    },
    [onError]
  )

  useEffect(() => {
    const AP = (window as any).ApplePaySession
    // Not an error and not worth a message: most of the world is not on Safari.
    if (!AP || !AP.canMakePayments?.() || !CLIENT_ID || !paypalOrderId(cart)) return

    let cancelled = false
    loadPaypalSdk(cart.currency_code || "usd")
      .then(async () => {
        const paypal = (window as any).paypal
        if (!paypal?.Applepay) return
        const cfg = await paypal.Applepay().config()
        if (cancelled || !cfg?.isEligible) return
        config.current = cfg
        setAvailable(true)
      })
      .catch(() => {
        /* stay silent: an unavailable wallet is not a customer-facing failure */
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.payment_collection?.id])

  const pay = useCallback(async () => {
    const AP = (window as any).ApplePaySession
    const paypal = (window as any).paypal
    const cfg = config.current
    const orderId = paypalOrderId(cart)
    if (!AP || !cfg || !orderId) return

    setError(null)
    setBusy(true)

    const currency = (cart.currency_code || "usd").toUpperCase()
    // The amount the customer was shown, and the one the cart guard checked.
    const total = Number(cart.total ?? 0).toFixed(2)

    const session = new AP(4, {
      countryCode: cfg.countryCode || "US",
      currencyCode: currency,
      merchantCapabilities: cfg.merchantCapabilities,
      supportedNetworks: cfg.supportedNetworks,
      requiredBillingContactFields: ["postalAddress", "name"],
      total: { label: DISPLAY_NAME, amount: total, type: "final" },
    })

    session.onvalidatemerchant = async (event: any) => {
      try {
        const merchantSession = await paypal.Applepay().validateMerchant({
          validationUrl: event.validationURL,
          displayName: DISPLAY_NAME,
        })
        session.completeMerchantValidation(merchantSession.merchantSession)
      } catch (e: any) {
        // The overwhelmingly likely cause is an unregistered domain. Say that in
        // the log rather than making someone guess from a generic failure.
        session.abort()
        setBusy(false)
        fail(
          "Apple Pay could not start. If this is a new domain, it may not be registered with PayPal."
        )
      }
    }

    session.onpaymentauthorized = async (event: any) => {
      try {
        const res = await paypal.Applepay().confirmOrder({
          orderId,
          token: event.payment.token,
          billingContact: event.payment.billingContact,
        })
        if (res?.status && res.status !== "APPROVED" && res.status !== "COMPLETED") {
          throw new Error("Apple Pay could not confirm this payment.")
        }
        // Tell Apple BEFORE completing the cart: the sheet is in the customer's
        // hand and must not hang behind our order call.
        session.completePayment(AP.STATUS_SUCCESS)
        await onApproved()
      } catch (e: any) {
        // Next's redirect means the ORDER WAS PLACED. Telling Apple the payment
        // failed here would show a failure sheet on a paid order.
        if (isRedirectSignal(e)) {
          session.completePayment(AP.STATUS_SUCCESS)
        } else {
          session.completePayment(AP.STATUS_FAILURE)
          fail(customerMessage(e))
        }
      } finally {
        setBusy(false)
      }
    }

    session.oncancel = () => {
      // The customer dismissed the sheet. Nothing was charged and nothing is wrong.
      setBusy(false)
      setError(null)
    }

    session.begin()
  }, [cart, fail, onApproved])

  if (!available) return null

  return (
    <div className="flex flex-col gap-y-2">
      <button
        type="button"
        onClick={pay}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label="Pay with Apple Pay"
        className="h-11 w-full rounded bg-black text-white disabled:opacity-60"
      >
         Pay
      </button>
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
