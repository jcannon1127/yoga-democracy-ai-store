"use client"

import { useActionState } from "react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { submitPasswordReset } from "@lib/data/customer"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"

type Props = {
  token: string
  email: string
}

/**
 * Set a new password from an emailed link.
 *
 * `token` and `email` come from the query string and travel as hidden fields. The token is a
 * signed, 15-minute JWT that already carries the email, so editing the hidden field cannot
 * reset somebody else's account — the server rejects the mismatch. The visible email is there
 * so a customer with two addresses can see which account they are about to change.
 */
const ResetPassword = ({ token, email }: Props) => {
  const [state, formAction] = useActionState(submitPasswordReset, null)

  // A link with no token is the single most likely way a customer arrives here broken — mail
  // clients truncate long URLs. Say what happened and give the way out, rather than rendering
  // a form that cannot possibly succeed.
  if (!token) {
    return (
      <div
        className="max-w-sm w-full flex flex-col items-center"
        data-testid="reset-password-invalid"
      >
        <h1 className="text-large-semi uppercase mb-6">Link not valid</h1>
        <p className="text-center text-base-regular text-ui-fg-base mb-8">
          This password reset link is incomplete or has expired. Reset links are
          good for 15 minutes.
        </p>
        <LocalizedClientLink
          href="/account/forgot-password"
          className="inline-flex items-center min-h-[44px] px-1 underline"
        >
          Request a new link
        </LocalizedClientLink>
      </div>
    )
  }

  if (state?.state === "success") {
    return (
      <div
        className="max-w-sm w-full flex flex-col items-center"
        data-testid="reset-password-success"
      >
        <h1 className="text-large-semi uppercase mb-6">Password updated</h1>
        <p className="text-center text-base-regular text-ui-fg-base mb-8">
          Your password has been changed. You can sign in with it now.
        </p>
        <LocalizedClientLink
          href="/account"
          className="inline-flex items-center min-h-[44px] px-1 underline"
        >
          Sign in
        </LocalizedClientLink>
      </div>
    )
  }

  return (
    <div
      className="max-w-sm w-full flex flex-col items-center"
      data-testid="reset-password-page"
    >
      <h1 className="text-large-semi uppercase mb-6">Set a new password</h1>
      {email ? (
        <p className="text-center text-base-regular text-ui-fg-base mb-8">
          Choose a new password for <span className="font-semibold">{email}</span>.
        </p>
      ) : (
        <p className="text-center text-base-regular text-ui-fg-base mb-8">
          Choose a new password for your account.
        </p>
      )}
      <form className="w-full" action={formAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />
        <div className="flex flex-col w-full gap-y-2">
          <Input
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            data-testid="reset-password-input"
          />
          <Input
            label="Confirm new password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            data-testid="reset-password-confirm-input"
          />
        </div>
        <ErrorMessage
          error={state?.state === "error" ? state.message : null}
          data-testid="reset-password-error-message"
        />
        <SubmitButton
          data-testid="reset-password-submit-button"
          className="w-full mt-6"
        >
          Save new password
        </SubmitButton>
      </form>
    </div>
  )
}

export default ResetPassword
