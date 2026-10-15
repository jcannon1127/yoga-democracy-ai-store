import { retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import PaymentWrapper from "@modules/checkout/components/payment-wrapper"
import CheckoutForm from "@modules/checkout/templates/checkout-form"
import CheckoutSummary from "@modules/checkout/templates/checkout-summary"
import { Metadata } from "next"
import { redirect } from "next/navigation"

import { regionPath } from "@lib/util/product-url"

export const metadata: Metadata = {
  title: "Checkout",
}

export default async function Checkout({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const cart = await retrieveCart()

  if (!cart) {
    // No cart is not "this page does not exist". It is a customer whose cart expired or who
    // arrived on a link, and a hard 404 tells them the shop is broken. Live sends them to the
    // basket, which is also what `data/url-map.csv` was trying to express with its
    // `/checkout -> /cart` row -- **the intent was right and the mechanism was wrong**: that
    // row was an unconditional PERMANENT redirect, so it fired for customers who DID have a
    // cart and made checkout unreachable for everyone. The condition belongs here, where the
    // cart is known, and it is temporary because tomorrow the same URL must work.
    const { countryCode } = await params
    redirect(regionPath(countryCode, "/cart"))
  }

  const customer = await retrieveCustomer()

  return (
    <div className="grid grid-cols-1 small:grid-cols-[1fr_416px] content-container gap-x-40 py-12">
      <PaymentWrapper cart={cart}>
        <CheckoutForm cart={cart} customer={customer} />
      </PaymentWrapper>
      <CheckoutSummary cart={cart} />
    </div>
  )
}
