import { login } from "@lib/data/customer"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { LOGIN_VIEW } from "@modules/account/templates/login-template"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
import { useActionState } from "react"

type Props = {
  setCurrentView: (view: LOGIN_VIEW) => void
}

const Login = ({ setCurrentView }: Props) => {
  const [message, formAction] = useActionState(login, null)

  return (
    <div
      className="max-w-sm w-full flex flex-col items-center"
      data-testid="login-page"
    >
      {/*
        The starter's "Sign in to access an enhanced shopping experience" said nothing and
        sounded like a template. This is the screen every returning customer lands on at
        cutover — none of them can sign in with their old password, because SFCC's hashes do
        not migrate — so it is the most consequential sentence in this lane. It now says what
        is actually behind the door.
      */}
      <h1 className="text-large-semi uppercase mb-6">Welcome back</h1>
      <p className="text-center text-base-regular text-ui-fg-base mb-8">
        Sign in to see your orders, track a delivery, and check out without
        re-typing your address.
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
            data-testid="email-input"
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            data-testid="password-input"
          />
        </div>
        <ErrorMessage error={message} data-testid="login-error-message" />
        {/*
          `inline-flex items-center min-h-[44px]` is not styling for its own sake. Measured at a
          verified 390px viewport (headless Firefox floors at 500px, so this needed the iframe
          tool) these links rendered 20px and 17px tall — well under the 44px touch minimum, on
          a phone, on the one link EVERY customer has to use at cutover because no SFCC password
          migrates. The padding is the tap target; the text size is unchanged.
        */}
        <div className="flex justify-end mt-2">
          {/*
            Every YD customer has to use this link once at cutover — SFCC's password hashes
            do not migrate — so it is not a rarely-used corner. It stays visible on the form.
          */}
          <LocalizedClientLink
            href="/account/forgot-password"
            className="inline-flex items-center min-h-[44px] px-1 text-small-regular text-ui-fg-base underline"
            data-testid="forgot-password-link"
          >
            Forgot your password?
          </LocalizedClientLink>
        </div>
        <SubmitButton data-testid="sign-in-button" className="w-full mt-6">
          Sign in
        </SubmitButton>
      </form>
      {/*
        Two sentences that are not decoration. Every returning customer has to set a password
        once — SFCC's do not migrate — and the ones who used Google or Facebook have no
        password to "forget", so the link above reads as not-for-them. Say it plainly here
        rather than losing them at the one screen they must get through.
      */}
      <p className="text-center text-small-regular text-ui-fg-subtle mt-6 max-w-xs">
        Shopped with us before?{" "}
        <LocalizedClientLink
          href="/account/forgot-password"
          className="inline-flex items-center min-h-[44px] px-1 underline"
          data-testid="first-time-password-link"
        >
          Set your password
        </LocalizedClientLink>{" "}
        — including if you used to sign in with Google or Facebook. Your order
        history is still here.
      </p>
      <p className="text-center text-small-regular text-ui-fg-subtle mt-3 max-w-xs">
        Just checking on an order?{" "}
        <LocalizedClientLink
          href="/order/track"
          className="underline"
          data-testid="track-order-link"
        >
          Track it without signing in
        </LocalizedClientLink>
        .
      </p>
      <span className="text-center text-ui-fg-base text-small-regular mt-6">
        Not a member?{" "}
        <button
          onClick={() => setCurrentView(LOGIN_VIEW.REGISTER)}
          className="underline"
          data-testid="register-button"
        >
          Join us
        </button>
        .
      </span>
    </div>
  )
}

export default Login
