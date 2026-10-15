"use client"

import React, { useActionState, useEffect } from "react"

import Input from "@modules/common/components/input"
import { HttpTypes } from "@medusajs/types"
import { updateCustomerEmail } from "@lib/data/customer"

import AccountInfo from "../account-info"

type MyInformationProps = {
  customer: HttpTypes.StoreCustomer
}

/**
 * Change the email address on the account — which is also the address you sign in with.
 *
 * WHAT THIS REPLACES, because the shape is worth remembering: the starter's version rendered
 * this same form with its `updateCustomer` call commented out and an action that returned
 * `{ success: true, error: null }` unconditionally. The customer typed a new address, pressed
 * Save, and was shown a green "Email updated succesfully" badge while nothing changed. It was
 * live on the profile page.
 *
 * The password field is not decoration. For emailpass the email IS the credential, so changing
 * it is the single most useful thing an attacker with a borrowed session could do — point the
 * account at an address they control, then "forget" the password. Requiring the password makes
 * that need more than a cookie.
 */
const ProfileEmail: React.FC<MyInformationProps> = ({ customer }) => {
  const [state, formAction] = useActionState(updateCustomerEmail, {
    state: "initial" as "initial" | "success" | "error",
    message: undefined as string | undefined,
  })
  const [successState, setSuccessState] = React.useState(false)

  useEffect(() => {
    setSuccessState(state.state === "success")
  }, [state])

  const clearState = () => setSuccessState(false)

  return (
    <form action={formAction} onReset={clearState} className="w-full">
      <AccountInfo
        label="Email"
        currentInfo={`${customer.email}`}
        isSuccess={successState}
        isError={state.state === "error"}
        errorMessage={state.message}
        clearState={clearState}
        data-testid="account-email-editor"
      >
        <div className="grid grid-cols-1 gap-y-2">
          <Input
            label="New email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={customer.email}
            data-testid="email-input"
          />
          <Input
            label="Your password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            data-testid="email-change-password-input"
          />
          <p className="text-small-regular text-ui-fg-subtle">
            This is also the address you sign in with, so it will change too.
          </p>
        </div>
      </AccountInfo>
    </form>
  )
}

export default ProfileEmail
