import { Metadata } from "next"

import ProfilePhone from "@modules/account//components/profile-phone"
import ProfileBillingAddress from "@modules/account/components/profile-billing-address"
import ProfileEmail from "@modules/account/components/profile-email"
import ProfileName from "@modules/account/components/profile-name"
import ProfilePassword from "@modules/account/components/profile-password"

import { notFound } from "next/navigation"
import LoginTemplate from "@modules/account/templates/login-template"
import { listRegions } from "@lib/data/regions"
import { retrieveCustomer } from "@lib/data/customer"
import { STORE_NAME } from "@lib/constants/store"

export const metadata: Metadata = {
  title: "Profile",
  description: `View and edit your ${STORE_NAME} profile.`,
}

export default async function Profile() {
/**
 * SIGNED OUT, THIS SAID THE PAGE DOES NOT EXIST.
 *
 * `notFound()` for a missing customer is wrong twice over. It tells a customer following a
 * bookmark that their profile is gone, when the page is fine and they are simply not signed in --
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

  const regions = await listRegions()
  if (!regions) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="profile-page-wrapper">
      <div className="mb-8 flex flex-col gap-y-4">
        <h1 className="text-2xl-semi">Profile</h1>
        <p className="text-base-regular">
          View and update your profile information, including your name, email,
          and phone number. You can also update your billing address, or change
          your password.
        </p>
      </div>
      <div className="flex flex-col gap-y-8 w-full">
        <ProfileName customer={customer} />
        <Divider />
        <ProfileEmail customer={customer} />
        <Divider />
        <ProfilePhone customer={customer} />
        <Divider />
        <ProfilePassword />
        <Divider />
        <ProfileBillingAddress customer={customer} regions={regions} />
      </div>
    </div>
  )
}

const Divider = () => {
  return <div className="w-full h-px bg-gray-200" />
}
;``
