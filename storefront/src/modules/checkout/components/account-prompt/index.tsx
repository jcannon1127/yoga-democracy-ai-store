"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Heading, Text } from "@medusajs/ui"
import { login, signup } from "@lib/data/customer"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Input from "@modules/common/components/input"
import ErrorMessage from "../error-message"
import { SubmitButton } from "../submit-button"

/**
 * Sign in or create an account WITHOUT LEAVING CHECKOUT.
 *
 * The scope calls out "register, including from inside checkout" as launch-blocking, and this
 * is why: half of YD's orders come from repeat customers, and a returning customer who has to
 * leave checkout to sign in is a customer who may not come back to it. Sending them to
 * /account and back is not a smaller version of this — it is the failure it exists to avoid.
 *
 * Both `login` and `signup` already call `transferCart()`, so the cart in progress follows the
 * customer into their session rather than being stranded on the anonymous one. That is the
 * part that would silently lose an order if it were missing, so it is worth naming: this
 * component adds no cart handling of its own precisely because the actions already do it
 * correctly.
 *
 * `router.refresh()` after success is not cosmetic. The checkout page is a server component
 * that reads the customer to prefill the address step; without the refresh the customer is
 * signed in and the form in front of them is still empty.
 */

type Mode = "closed" | "sign-in" | "register"

const AccountPrompt = () => {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>("closed")

  const [loginResult, loginAction] = useActionState(login, null)
  const [signupResult, signupAction] = useActionState(signup, null)

  // Both actions return a string on failure. `login` returns undefined on success and `signup`
  // returns the created customer object, so "not a string and not null" is the success signal
  // for either.
  const loginError = typeof loginResult === "string" ? loginResult : null
  const signupError = typeof signupResult === "string" ? signupResult : null

  useEffect(() => {
    if (loginResult !== null && !loginError) router.refresh()
  }, [loginResult, loginError, router])

  useEffect(() => {
    if (signupResult !== null && !signupError) router.refresh()
  }, [signupResult, signupError, router])

  return (
    <div className="bg-white border border-gray-200 rounded-md p-6">
      <div className="flex flex-col small:flex-row small:items-center small:justify-between gap-y-2">
        <div className="flex flex-col">
          <Heading level="h2" className="text-xl-semi">
            Have an account?
          </Heading>
          <Text className="text-small-regular text-ui-fg-subtle">
            Sign in to check out faster, or create an account as you go.
          </Text>
          {/*
            The live site opens checkout with a Customer step carrying Login with Google and
            Facebook. We deliberately do NOT gate checkout on a customer step (see
            docs/deviations.md — fewer steps to a completed order), so this stays an optional
            panel. But a customer who always signed in with Google arrives here, finds no
            Google button, and has no idea that setting a password on the same address gets
            them in. That sentence is the whole fix, and checkout is where it is most needed.
          */}
          <Text className="text-xsmall-regular text-ui-fg-subtle">
            Used to sign in with Google or Facebook?{" "}
            <LocalizedClientLink
              href="/account/forgot-password"
              className="underline"
              data-testid="checkout-social-route-in"
            >
              Set a password
            </LocalizedClientLink>{" "}
            on the same email address.
          </Text>
        </div>
        <div className="flex gap-x-4">
          <button
            type="button"
            onClick={() => setMode(mode === "sign-in" ? "closed" : "sign-in")}
            className="underline text-base-regular"
            data-testid="checkout-sign-in-toggle"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "register" ? "closed" : "register")}
            className="underline text-base-regular"
            data-testid="checkout-register-toggle"
          >
            Create an account
          </button>
        </div>
      </div>

      {mode === "sign-in" && (
        <form
          className="mt-6 max-w-sm"
          action={loginAction}
          data-testid="checkout-sign-in-form"
        >
          <div className="flex flex-col gap-y-2">
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              data-testid="checkout-login-email-input"
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              data-testid="checkout-login-password-input"
            />
          </div>
          <ErrorMessage
            error={loginError}
            data-testid="checkout-login-error-message"
          />
          <div className="flex justify-end mt-2">
            <LocalizedClientLink
              href="/account/forgot-password"
              className="text-small-regular underline"
            >
              Forgot your password?
            </LocalizedClientLink>
          </div>
          <SubmitButton className="w-full mt-4" data-testid="checkout-sign-in-button">
            Sign in
          </SubmitButton>
        </form>
      )}

      {mode === "register" && (
        <form
          className="mt-6 max-w-sm"
          action={signupAction}
          data-testid="checkout-register-form"
        >
          <div className="flex flex-col gap-y-2">
            <Input
              label="First name"
              name="first_name"
              autoComplete="given-name"
              required
              data-testid="checkout-register-first-name-input"
            />
            <Input
              label="Last name"
              name="last_name"
              autoComplete="family-name"
              required
              data-testid="checkout-register-last-name-input"
            />
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              data-testid="checkout-register-email-input"
            />
            <Input
              label="Phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              data-testid="checkout-register-phone-input"
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              data-testid="checkout-register-password-input"
            />
          </div>
          <ErrorMessage
            error={signupError}
            data-testid="checkout-register-error-message"
          />
          <SubmitButton
            className="w-full mt-4"
            data-testid="checkout-register-button"
          >
            Create account and continue
          </SubmitButton>
        </form>
      )}
    </div>
  )
}

export default AccountPrompt
