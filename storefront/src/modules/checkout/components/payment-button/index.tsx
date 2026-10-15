"use client"

import { isManual, isPaypal, isStripeLike } from "@lib/constants"
import PaypalButton from "./paypal-button"
import GooglePayButton from "./googlepay-button"
import ApplePayButton from "./applepay-button"
import PaypalCardForm from "./paypal-card-form"
import { placeOrder } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@medusajs/ui"
import { useElements, useStripe } from "@stripe/react-stripe-js"
import { useSearchParams } from "next/navigation"
import React, { useState } from "react"

import { CARD_TENDER } from "@lib/util/tender"
import ErrorMessage from "../error-message"

type PaymentButtonProps = {
  cart: HttpTypes.StoreCart
  "data-testid": string
}

const PaymentButton: React.FC<PaymentButtonProps> = ({
  cart,
  "data-testid": dataTestId,
}) => {
  const notReady =
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    (cart.shipping_methods?.length ?? 0) < 1

  const paymentSession = cart.payment_collection?.payment_sessions?.[0]

  switch (true) {
    case isStripeLike(paymentSession?.provider_id):
      return (
        <StripePaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    case isPaypal(paymentSession?.provider_id):
      return (
        <PaypalPaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    case isManual(paymentSession?.provider_id):
      return (
        <ManualTestPaymentButton notReady={notReady} data-testid={dataTestId} />
      )
    default:
      return <Button disabled>Select a payment method</Button>
  }
}

const StripePaymentButton = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    await placeOrder()
      .catch((err) => {
        setErrorMessage(err.message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const stripe = useStripe()
  const elements = useElements()
  const card = elements?.getElement("card")

  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending"
  )

  const disabled = !stripe || !elements ? true : false

  const handlePayment = async () => {
    setSubmitting(true)

    if (!stripe || !elements || !card || !cart) {
      setSubmitting(false)
      return
    }

    await stripe
      .confirmCardPayment(session?.data.client_secret as string, {
        payment_method: {
          card: card,
          billing_details: {
            name:
              cart.billing_address?.first_name +
              " " +
              cart.billing_address?.last_name,
            address: {
              city: cart.billing_address?.city ?? undefined,
              country: cart.billing_address?.country_code ?? undefined,
              line1: cart.billing_address?.address_1 ?? undefined,
              line2: cart.billing_address?.address_2 ?? undefined,
              postal_code: cart.billing_address?.postal_code ?? undefined,
              state: cart.billing_address?.province ?? undefined,
            },
            email: cart.email,
            phone: cart.billing_address?.phone ?? undefined,
          },
        },
      })
      .then(({ error, paymentIntent }) => {
        if (error) {
          const pi = error.payment_intent

          if (
            (pi && pi.status === "requires_capture") ||
            (pi && pi.status === "succeeded")
          ) {
            onPaymentCompleted()
          }

          setErrorMessage(error.message || null)
          return
        }

        if (
          (paymentIntent && paymentIntent.status === "requires_capture") ||
          paymentIntent.status === "succeeded"
        ) {
          return onPaymentCompleted()
        }

        return
      })
  }

  return (
    <>
      <Button
        disabled={disabled || notReady}
        onClick={handlePayment}
        size="large"
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="stripe-payment-error-message"
      />
    </>
  )
}

/**
 * PayPal takes the buyer through approval inside PayPal's own iframe, so there is
 * no "Place order" button of ours to press -- PayPal's button IS the submit. On
 * approval we complete the cart exactly as the other providers do.
 */
const PaypalPaymentButton = ({
  cart,
  notReady,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // Which tender the customer actually chose. Cards and PayPal share this provider, so the
  // session cannot say; the payment step puts it in the URL. Absent means PayPal, which is
  // also what a bookmarked review URL from before this change means.
  const payingByCard = useSearchParams().get("tender") === CARD_TENDER

  const approve = async () => {
    setErrorMessage(null)
    await placeOrder()
  }

  return (
    <>
      {payingByCard ? (
        /* Cards, through PayPal. Rides the same PayPal order. See the note in
           paypal-card-form.tsx: a card path that needs no processor provisioning
           and nobody in a console. */
        <PaypalCardForm
          cart={cart}
          disabled={notReady}
          onApproved={approve}
          onError={(m) => setErrorMessage(m)}
        />
      ) : (
        <>
          <PaypalButton
            cart={cart}
            disabled={notReady}
            onApproved={approve}
            onError={(m) => setErrorMessage(m)}
          />
          {/* Wallets ride on the SAME PayPal order -- a funding source, not another
              provider and not another order. Each renders only where it can work:
              Google Pay when the merchant is eligible, Apple Pay only in Safari.
              They belong with the PayPal button rather than with the card fields:
              a customer who chose "Credit card" asked for a card. */}
          <GooglePayButton
            cart={cart}
            disabled={notReady}
            onApproved={approve}
            onError={(m) => setErrorMessage(m)}
          />
          <ApplePayButton
            cart={cart}
            disabled={notReady}
            onApproved={approve}
            onError={(m) => setErrorMessage(m)}
          />
        </>
      )}
      <ErrorMessage
        error={errorMessage}
        data-testid="paypal-payment-error-message"
      />
    </>
  )
}

const ManualTestPaymentButton = ({ notReady }: { notReady: boolean }) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    await placeOrder()
      .catch((err) => {
        setErrorMessage(err.message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const handlePayment = () => {
    setSubmitting(true)

    onPaymentCompleted()
  }

  return (
    <>
      <Button
        disabled={notReady}
        isLoading={submitting}
        onClick={handlePayment}
        size="large"
        data-testid="submit-order-button"
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="manual-payment-error-message"
      />
    </>
  )
}

export default PaymentButton
