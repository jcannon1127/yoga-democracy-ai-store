"use client"

import React, { useActionState, useEffect } from "react"

import Input from "@modules/common/components/input"
import { updateCustomerPassword } from "@lib/data/customer"

import AccountInfo from "../account-info"

/**
 * Change your password while signed in.
 *
 * The starter shipped this component as a stub: three real password fields above an action that
 * toasted "Password update is not implemented". It was then commented out of the profile page,
 * while the page's own copy went on telling the customer they could "change your password" here.
 *
 * It is backed by a route this project had to add — Medusa 2.19's only password-update endpoint
 * takes single-use reset tokens and refuses a session. See
 * `src/api/store/customers/me/password/route.ts`.
 */
const ProfilePassword: React.FC = () => {
  const [state, formAction] = useActionState(updateCustomerPassword, {
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
        label="Password"
        currentInfo={<span>The password is not shown for security reasons</span>}
        isSuccess={successState}
        isError={state.state === "error"}
        errorMessage={state.message}
        clearState={clearState}
        data-testid="account-password-editor"
      >
        <div className="grid grid-cols-1 small:grid-cols-2 gap-4">
          <Input
            label="Current password"
            name="old_password"
            required
            type="password"
            autoComplete="current-password"
            data-testid="old-password-input"
          />
          <Input
            label="New password"
            type="password"
            name="new_password"
            required
            autoComplete="new-password"
            data-testid="new-password-input"
          />
          <Input
            label="Confirm new password"
            type="password"
            name="confirm_password"
            required
            autoComplete="new-password"
            data-testid="confirm-password-input"
          />
        </div>
      </AccountInfo>
    </form>
  )
}

export default ProfilePassword
