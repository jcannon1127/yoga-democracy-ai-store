"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { loadPaypalSdk } from "./paypal-sdk"
import { customerMessage, isRedirectSignal } from "./payment-errors"

/**
 * PayPal buyer-approval button.
 *
 * The provider has ALREADY created a PayPal order in `initiatePayment`, and its
 * id is on the payment session as `data.id`. So this button must NOT create a
 * second one — `createOrder` returns the existing id. Creating another would
 * leave an orphaned order at PayPal and charge against a different total than
 * the one the cart guard checked.
 *
 * Provider-shaped by nature, and budgeted as throwaway if the gateway changes.
 */

type Props = {
  cart: HttpTypes.StoreCart
  /** Called after the buyer approves. Should complete the cart. */
  onApproved: () => void | Promise<void>
  onError?: (message: string) => void
  disabled?: boolean
}

type PaypalSessionData = {
  id?: string
  status?: string
  free_order?: boolean
  links?: Array<{ rel?: string; href?: string }>
}

// The provider's own signal for a basket that costs nothing. PayPal REFUSES a
// zero-amount order (CANNOT_BE_ZERO_OR_NEGATIVE), so `initiatePayment`
// short-circuits to a synthetic session with this id and never calls PayPal.
const FREE_ORDER_ID = "FREE_ORDER"

function isFreeOrder(data: PaypalSessionData | null, cart: HttpTypes.StoreCart): boolean {
  return data?.free_order === true || data?.id === FREE_ORDER_ID || Number(cart.total ?? 0) <= 0
}

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

function readSession(cart: HttpTypes.StoreCart): PaypalSessionData | null {
  const s = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending" && s.provider_id?.startsWith("pp_paypal")
  )
  const data = s?.data as PaypalSessionData | undefined
  return data?.id ? data : null
}

export default function PaypalButton({ cart, onApproved, onError, disabled }: Props) {
  const [ready, setReady] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const rendered = useRef(false)

  const fail = useCallback(
    (message: string) => {
      setError(message)
      onError?.(message)
    },
    [onError]
  )

  const free = isFreeOrder(readSession(cart), cart)

  useEffect(() => {
    // A free basket has no PayPal order to approve, so there is nothing to render
    // PayPal's buttons against. Rendering them anyway gives the customer a
    // PayPal button wired to the string "FREE_ORDER", which cannot work.
    if (free) return
    if (rendered.current) return
    const session = readSession(cart)
    if (!session?.id) {
      // No PayPal order means initiatePayment never ran or failed. Say so rather
      // than rendering an empty box, which reads as a slow load and makes a
      // customer wait instead of choosing another method.
      fail("PayPal is unavailable right now. Please choose another payment method.")
      return
    }

    let cancelled = false
    loadPaypalSdk(cart.currency_code || "usd")
      .then(() => {
        if (cancelled || !container.current) return
        const paypal = (window as any).paypal
        if (!paypal?.Buttons) throw new Error("PayPal failed to initialise.")

        paypal
          .Buttons({
            style: { layout: "horizontal", tagline: false, height: 44 },
            // Reuse the order the provider already created. Do NOT create another.
            createOrder: () => session.id,
            onApprove: async () => {
              setBusy(true)
              try {
                await onApproved()
              } catch (e: any) {
                // Success leaves this page by throwing a redirect. Not a failure.
                if (!isRedirectSignal(e)) fail(customerMessage(e))
              } finally {
                setBusy(false)
              }
            },
            onCancel: () => {
              // Not an error. The customer chose to back out and nothing was charged.
              setError(null)
            },
            onError: () => {
              // PayPal does not tell us why here. Do NOT claim the card or account
              // was declined -- we do not know that.
              fail("Something went wrong with PayPal. Please try again.")
            },
          })
          .render(container.current)
          .then(() => {
            rendered.current = true
            setReady(true)
          })
      })
      .catch((e: Error) => {
        if (!cancelled) fail(e.message || "PayPal failed to load.")
      })

    return () => {
      cancelled = true
    }
    // Keyed on the payment session: re-rendering on every cart change would tear
    // down PayPal's iframe mid-approval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.payment_collection?.id, free])

  /**
   * ZERO-TOTAL BASKETS ARE A NORMAL FLOW, NOT AN ABUSE CASE.
   *
   * The provider's free-order path was built for two 100%-off codes that are
   * deliberately held and must never exist in Medusa -- so it looked like a path
   * only a mistake could reach. It is not. yd-promo measured the live site: a
   * Yotpo reward capped to a small sale basket **settles 10 real orders at $0.00
   * grand total**, merchandise, shipping and tax all zeroed, out of 875
   * redemptions worth $39,331 and growing. SFCC runs `plugin_zero_order_amount`
   * for exactly this reason: no processor can authorise $0.
   *
   * So the button has to work for it. There is nothing to approve and nothing to
   * charge -- the session is already settled locally -- so this places the order
   * directly.
   *
   * NOT PROVEN IN A BROWSER. Reaching it needs a cart that actually totals zero,
   * which needs a promotion, which is yd-promo's lane and not mine to create in
   * a shared store. The logic is here and the gap is stated rather than implied.
   */
  if (free) {
    return (
      <div className="flex flex-col gap-y-3">
        <button
          type="button"
          disabled={disabled || placing}
          aria-busy={placing}
          onClick={async () => {
            setPlacing(true)
            try {
              await onApproved()
            } catch (e: any) {
              fail(e?.message || "We could not place your order.")
            } finally {
              setPlacing(false)
            }
          }}
          className="h-11 w-full rounded bg-ui-button-inverted text-ui-fg-on-inverted disabled:opacity-60"
          data-testid="free-order-place-order"
        >
          Place order
        </button>
        <span className="text-ui-fg-subtle text-sm" data-testid="free-order-notice">
          No payment is needed — your order total is {cart.currency_code?.toUpperCase()} 0.00.
        </span>
        {error && (
          <div role="alert" className="text-ui-fg-error text-sm">
            {error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div
        ref={container}
        aria-busy={busy}
        className={disabled || busy ? "pointer-events-none opacity-60" : undefined}
      />
      {!ready && !error && (
        <span className="text-ui-fg-subtle text-sm">Loading PayPal…</span>
      )}
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
