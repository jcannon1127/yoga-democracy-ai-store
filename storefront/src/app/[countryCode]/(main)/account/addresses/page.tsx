import { Metadata } from "next"
import { notFound } from "next/navigation"
import LoginTemplate from "@modules/account/templates/login-template"

import AddressBook from "@modules/account/components/address-book"

import { getRegion } from "@lib/data/regions"
import { retrieveCustomer } from "@lib/data/customer"

export const metadata: Metadata = {
  title: "Addresses",
  description: "View your addresses",
}

export default async function Addresses(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params
  const { countryCode } = params
/**
 * SIGNED OUT, THIS SAID THE PAGE DOES NOT EXIST.
 *
 * `notFound()` for a missing customer is wrong twice over. It tells a customer following a
 * bookmark that their saved addresses is gone, when the page is fine and they are simply not signed in --
 * so they go looking for a broken link instead of signing in. And it renders inside the account
 * layout at HTTP 200, which is a soft-404.
 *
 * `/account` already had this right: it branches on the customer and renders the login form.
 * These three did not, so the account area disagreed with itself depending which URL you
 * arrived at. Measured on the deployed build 2026-08-26, not inferred.
 *
 * `notFound()` is kept for genuinely missing DATA below -- a missing region is a broken store,
 * not a signed-out visitor, and the two must not collapse into one answer.
 */
  const customer = await retrieveCustomer().catch(() => null)
  if (!customer) {
    return <LoginTemplate />
  }

  const region = await getRegion(countryCode)
  if (!region) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="addresses-page-wrapper">
      <div className="mb-8 flex flex-col gap-y-4">
        <h1 className="text-2xl-semi">Shipping Addresses</h1>
        <p className="text-base-regular">
          View and update your shipping addresses, you can add as many as you
          like. Saving your addresses will make them available during checkout.
        </p>
      </div>
      <AddressBook customer={customer} region={region} />
    </div>
  )
}
