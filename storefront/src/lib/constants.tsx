import React from "react"
import { CreditCard } from "@medusajs/icons"

import Ideal from "@modules/common/icons/ideal"
import Bancontact from "@modules/common/icons/bancontact"
import PayPal from "@modules/common/icons/paypal"

/* Map of payment provider_id to their title and icon. Add in any payment providers you want to use. */
export const paymentInfoMap: Record<
  string,
  { title: string; icon: React.JSX.Element }
> = {
  pp_stripe_stripe: {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_medusa-payments_default": {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_stripe-ideal_stripe": {
    title: "iDeal",
    icon: <Ideal />,
  },
  "pp_stripe-bancontact_stripe": {
    title: "Bancontact",
    icon: <Bancontact />,
  },
  // Cards are a PayPal FUNDING SOURCE, not another provider -- one order, one session. But a
  // customer does not think "PayPal, and inside it, a card": the live site lists a card option
  // and PayPal as separate choices, and burying cards under PayPal means a customer who wants
  // to pay by card sees no card option at all. So the list shows two entries that resolve to
  // the same provider; `:card` is a UI suffix and is stripped before any session is created.
  "pp_paypal_paypal:card": {
    title: "Credit card",
    icon: <CreditCard />,
  },
  pp_paypal_paypal: {
    title: "PayPal",
    icon: <PayPal />,
  },
  // Without this the option renders as the raw id `pp_cybersource_cybersource`
  // to the customer. Seen in a browser at the payment step on 2026-08-24.
  pp_cybersource_cybersource: {
    title: "Credit card",
    icon: <CreditCard />,
  },
  pp_system_default: {
    title: "Manual Payment",
    icon: <CreditCard />,
  },
  // Add more payment providers here
}

// This only checks if it is native stripe or medusa payments for card payments, it ignores the other stripe-based providers
export const isStripeLike = (providerId?: string) => {
  return (
    providerId?.startsWith("pp_stripe_") || providerId?.startsWith("pp_medusa-")
  )
}

/**
 * Providers the storefront can actually take a customer all the way through.
 *
 * PAYPAL IS NOW ENABLED. It was blocked here because the storefront had no buyer-approval
 * flow and selecting it left "Another step will appear" and a disabled button. That is no
 * longer true: PayPal, Google Pay and card payments all complete, each proven with a real
 * capture through this checkout (orders 17, 30 and 31, 2026-08-25).
 *
 * CYBERSOURCE IS BLOCKED, and this is the reversible half of a decision Jeff has not made yet.
 * It renders to customers as "Credit card" and CANNOT TAKE A PAYMENT -- the merchant has no
 * test processor, so `POST /pts/v2/payments` returns 404. That was tolerable while there was
 * no card route at all. Now that PayPal's card fields work, the checkout would offer TWO
 * credit-card options, one of which fails after the customer has typed their card number.
 * Blocking the broken one is not a decision about CyberSource's future -- it stays installed,
 * attached and allowlisted on the backend. Put `pp_cybersource` back in
 * NEXT_PUBLIC_ENABLED_PAYMENT_PROVIDERS the moment it is provisioned.
 *
 * Set NEXT_PUBLIC_ENABLED_PAYMENT_PROVIDERS to a comma-separated list of provider id prefixes
 * to override this entirely. Empty or unset means "everything except the blocked list below",
 * so either half can be changed without a deploy.
 */
const ENABLED_PROVIDERS = (process.env.NEXT_PUBLIC_ENABLED_PAYMENT_PROVIDERS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean)

const BLOCKED_PROVIDER_PREFIXES = [
  // Cannot take a payment -- see above. Remove when a processor exists.
  "pp_cybersource",
  // Manual Payment (pp_system_default) marks an order paid without taking any money. It is
  // enabled on the backend because it is how the payment work gets tested, but it renders to
  // customers as a selectable way to pay -- so at cutover anyone could place a real order for
  // free. Blocked here rather than on the backend so testing keeps working: set
  // NEXT_PUBLIC_ENABLED_PAYMENT_PROVIDERS to include pp_system_default to bring it back.
  //
  // It is also detached from the US region now, so this is the second of two locks.
  "pp_system_default",
]

export const isProviderEnabled = (providerId?: string) => {
  if (!providerId) return false
  if (ENABLED_PROVIDERS.length) {
    return ENABLED_PROVIDERS.some((p) => providerId.startsWith(p))
  }
  return !BLOCKED_PROVIDER_PREFIXES.some((p) => providerId.startsWith(p))
}

export const isPaypal = (providerId?: string) => {
  return providerId?.startsWith("pp_paypal")
}
export const isManual = (providerId?: string) => {
  return providerId?.startsWith("pp_system_default")
}

// Add currencies that don't need to be divided by 100
export const noDivisionCurrencies = [
  "krw",
  "jpy",
  "vnd",
  "clp",
  "pyg",
  "xaf",
  "xof",
  "bif",
  "djf",
  "gnf",
  "kmf",
  "mga",
  "rwf",
  "xpf",
  "htg",
  "vuv",
  "xag",
  "xdr",
  "xau",
]
