"use client"

import { useActionState } from "react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { requestPasswordReset } from "@lib/data/customer"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"

/**
 * "Forgot your password?" — request a reset link.
 *
 * The success copy below is written to be TRUE WHETHER OR NOT the address belongs to a
 * customer, because the answer is deliberately identical either way (see
 * `requestPasswordReset`). "We've sent you an email" would be a lie for an unknown address and
 * would also confirm which addresses are registered. "If there's an account…" is neither.
 */
const ForgotPassword = () => {
  const [state, formAction] = useActionState(requestPasswordReset, null)

  if (state?.state === "success") {
    return (
      <div
        className="max-w-sm w-full flex flex-col items-center"
        data-testid="forgot-password-sent"
      >
        <h1 className="text-large-semi uppercase mb-6">Check your email</h1>
        <p className="text-center text-base-regular text-ui-fg-base mb-8">
          If there is an account with that email address, we have sent it a link
          to set a password. The link is good for 15 minutes.
        </p>
        <p className="text-center text-small-regular text-ui-fg-subtle mb-8">
          Nothing arrived? Check your spam folder, then try again — and make
          sure you are using the address you order with.
        </p>
        <LocalizedClientLink
          href="/account"
          className="inline-flex items-center min-h-[44px] px-1 underline"
        >
          Back to sign in
        </LocalizedClientLink>
      </div>
    )
  }

  return (
    <div
      className="max-w-sm w-full flex flex-col items-center"
      data-testid="forgot-password-page"
    >
      {/*
        THE HEADING AND COPY COVER TWO DIFFERENT PEOPLE, DELIBERATELY.

        One forgot a password. The other never had one — they used "Login with Google" or
        "Login with Facebook" on the old site, which the new one does not have. Both need this
        exact page, and the second person will never click a link that says "Forgot your
        password?" because they have not forgotten anything. Naming their situation in the copy
        is the entire difference between the route existing and the route being findable.

        Mechanically they are identical: every migrated account has a credential-less identity,
        so "set a password for the first time" and "replace a forgotten one" are the same
        request. Verified against a real password-never-set account end to end.
      */}
      <h1 className="text-large-semi uppercase mb-6">Set your password</h1>
      <p className="text-center text-base-regular text-ui-fg-base mb-4">
        Enter the email address you order with and we will send you a link to
        set a password.
      </p>
      <p className="text-center text-small-regular text-ui-fg-subtle mb-8">
        This is the right page whether you have forgotten your password, or
        never had one because you used to sign in with Google or Facebook. Our
        new site does not use those, so set a password on the same email address
        and everything — including your order history — will be waiting.
      </p>
      <form className="w-full" action={formAction}>
        <div className="flex flex-col w-full gap-y-2">
          <Input
            label="Email"
            name="email"
            type="email"
            title="Enter a valid email address."
            autoComplete="email"
            required
            data-testid="forgot-password-email-input"
          />
        </div>
        <ErrorMessage
          error={state?.state === "error" ? state.message : null}
          data-testid="forgot-password-error-message"
        />
        <SubmitButton
          data-testid="forgot-password-submit-button"
          className="w-full mt-6"
        >
          Email me a link
        </SubmitButton>
      </form>
      <span className="text-center text-ui-fg-base text-small-regular mt-6">
        Already have a password?{" "}
        <LocalizedClientLink
          href="/account"
          className="inline-flex items-center min-h-[44px] px-1 underline"
        >
          Sign in
        </LocalizedClientLink>
        .
      </span>
    </div>
  )
}

export default ForgotPassword
