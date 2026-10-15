"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { loadPaypalSdk } from "./paypal-sdk"
import { customerMessage, isRedirectSignal } from "./payment-errors"

/**
 * Card payment, through PayPal's Advanced Card Fields.
 *
 * THIS IS A CARD PATH THAT NEEDS NOTHING FROM ANYONE. CyberSource has been the
 * blocker on the whole payment lane for days -- it needs a test processor that
 * needs a human in a console we cannot reach. PayPal's card fields are eligible
 * on YD's app today, and a real card has already gone through them:
 *
 *     VISA 4111…1111 -> PayPal order 9L893029NW6471142 APPROVED
 *     -> Medusa order 29, $29.99, captured 5KD264114M6937445
 *
 * Cards are the majority of YD's orders, so this matters more than either wallet.
 *
 * Like every other PayPal surface here, it rides the order the provider ALREADY
 * created. `createOrder` returns that id; creating a second would orphan the
 * first and charge against a total no guard has checked.
 *
 * THE FIELDS ARE CROSS-ORIGIN IFRAMES, which is the point of them: the card
 * number never touches YD's page, YD's server or YD's logs. Nothing here can
 * read what the customer typed, and nothing here should try.
 */

type Props = {
  cart: HttpTypes.StoreCart
  /** Called after PayPal approves the card. Should complete the cart. */
  onApproved: () => void | Promise<void>
  onError?: (message: string) => void
  disabled?: boolean
}

const FREE_ORDER_ID = "FREE_ORDER"

function paypalOrderId(cart: HttpTypes.StoreCart): string | null {
  const s = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending" && s.provider_id?.startsWith("pp_paypal")
  )
  const id = (s?.data as { id?: string } | undefined)?.id
  // A zero-total basket has no PayPal order to charge -- see paypal-button.tsx.
  return id && id !== FREE_ORDER_ID ? id : null
}

export default function PaypalCardForm({ cart, onApproved, onError, disabled }: Props) {
  const [ready, setReady] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fields = useRef<any>(null)
  const built = useRef(false)

  const fail = useCallback(
    (message: string) => {
      setError(message)
      onError?.(message)
    },
    [onError]
  )

  useEffect(() => {
    if (built.current) return
    const orderId = paypalOrderId(cart)
    if (!orderId) return

    let cancelled = false
    loadPaypalSdk(cart.currency_code || "usd")
      .then(async () => {
        if (cancelled) return
        const paypal = (window as any).paypal
        if (!paypal?.CardFields) return

        const cf = paypal.CardFields({
          createOrder: () => orderId,
          onApprove: async () => {
            try {
              await onApproved()
            } catch (e: any) {
              // A redirect is how success LEAVES this page. Rendering it told a
              // paying customer "NEXT_REDIRECT" on their way to the receipt.
              if (!isRedirectSignal(e)) fail(customerMessage(e))
            } finally {
              setSubmitting(false)
            }
          },
          onError: (e: any) => {
            setSubmitting(false)
            // eslint-disable-next-line no-console
            console.error("[yd-card] PayPal card error", e)
            fail(customerMessage(e))
          },
        })

        if (!cf.isEligible?.()) return

        // Each field renders into its own container, because each is a separate
        // cross-origin iframe.
        await cf.NumberField().render("#yd-card-number")
        await cf.ExpiryField().render("#yd-card-expiry")
        await cf.CVVField().render("#yd-card-cvv")
        await cf.NameField().render("#yd-card-name")
        if (cancelled) return
        fields.current = cf
        built.current = true
        setReady(true)
      })
      .catch(() => {
        // A card form that cannot load is not worth a red message on a page that
        // still offers PayPal and the wallets.
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.payment_collection?.id])

  const submit = useCallback(async () => {
    if (!fields.current) return
    setError(null)
    setSubmitting(true)
    try {
      await fields.current.submit()
      // Deliberately no success handling here: approval arrives via onApprove.
      // Treating a resolved submit() as success would place the order before
      // PayPal had approved the card.
    } catch (e: any) {
      setSubmitting(false)
      if (isRedirectSignal(e)) return
      // `e.message` here is PayPal's raw HTTP body. It went on the page once; it
      // does not go on the page again.
      // eslint-disable-next-line no-console
      console.error("[yd-card] card submit failed", e)
      fail(customerMessage(e))
    }
  }, [fail])

  // Containers stay mounted whether or not the form is ready: PayPal renders INTO
  // them, so they have to exist first. Hiding them until ready — rather than
  // returning null — is what makes that possible. Returning null cost an hour on
  // the Google Pay button, which never rendered because its own ref never existed.
  return (
    <div className={`flex flex-col gap-y-3 ${!ready && !error ? "hidden" : ""}`}>
      <span className="text-ui-fg-subtle text-sm">Or pay by card</span>
      <div id="yd-card-number" />
      <div className="flex gap-x-2">
        <div id="yd-card-expiry" className="flex-1" />
        <div id="yd-card-cvv" className="flex-1" />
      </div>
      <div id="yd-card-name" />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || submitting || !ready}
        aria-busy={submitting}
        className="h-11 w-full rounded bg-ui-button-inverted text-ui-fg-on-inverted disabled:opacity-60"
        data-testid="paypal-card-submit"
      >
        {submitting ? "Processing…" : "Pay by card"}
      </button>
      {error && (
        <div role="alert" className="text-ui-fg-error text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
