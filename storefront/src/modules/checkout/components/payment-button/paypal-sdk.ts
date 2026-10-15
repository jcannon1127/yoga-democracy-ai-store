/**
 * ONE loader for the PayPal SDK, shared by every button that needs it.
 *
 * WHY THIS EXISTS, and it is not tidiness. The PayPal SDK initialises ONCE per
 * page from the query string of whichever script tag loads first. The PayPal
 * button and the Google Pay button each had their own loader with a different
 * `components=` list, and the result was not an error: **the PayPal button
 * silently stopped rendering** — "Loading PayPal…" forever, zero button iframes,
 * nothing in the console. One wallet took out the tender that already worked.
 *
 * So the components list is a UNION built here, the script is injected once, and
 * every caller awaits the same promise. Adding a wallet means adding to
 * `COMPONENTS`, never adding a second script tag.
 *
 * Pay Later stays disabled here too, for the same reason it is disabled on the
 * button: YD offers BNPL nowhere, and it must not arrive as a side effect.
 * (Note that this only governs OUR buttons — PayPal's own approval page still
 * offers Pay in 4 and Pay Monthly, which is an account-level question.)
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

/**
 * The component list is CONDITIONAL, and the reason is measured.
 *
 * Asking for `applepay` in a browser that has no Apple Pay does not degrade
 * gracefully: **PayPal's Buttons stop rendering entirely.** No error, no console
 * message, no rejected promise -- `window.paypal.Buttons` exists, the container
 * exists, and `.render()` simply never settles. The checkout showed
 * "Loading PayPal…" forever and the only working tender on the site was gone.
 *
 * Proven by removing one word: with `applepay` in the list, zero button iframes;
 * without it, the PayPal button and the Google Pay button both render. Same
 * page, same session, same commit.
 *
 * Apple Pay only functions in Safari and on iOS anyway, so gating on
 * `window.ApplePaySession` costs nothing and removes the failure everywhere else.
 */
function components(): string[] {
  const list = ["buttons", "card-fields", "googlepay"]
  if (typeof window !== "undefined" && (window as any).ApplePaySession) {
    list.push("applepay")
  }
  return list
}

const MARKER = "yd-paypal-sdk"

let pending: Promise<void> | null = null

export function loadPaypalSdk(currency: string): Promise<void> {
  if (pending) return pending

  pending = new Promise<void>((resolve, reject) => {
    if ((window as any).paypal?.Buttons) return resolve()
    if (!CLIENT_ID) return reject(new Error("PayPal is unavailable."))

    const existing = document.querySelector<HTMLScriptElement>(`script[data-yd="${MARKER}"]`)
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error("PayPal failed to load.")))
      return
    }

    const payLater = process.env.NEXT_PUBLIC_PAYPAL_ENABLE_PAY_LATER === "true"
    const s = document.createElement("script")
    s.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CLIENT_ID)}` +
      `&currency=${encodeURIComponent(currency.toUpperCase())}` +
      `&components=${components().join(",")}&intent=capture` +
      (payLater ? "" : "&disable-funding=paylater")
    s.dataset.yd = MARKER
    s.onload = () => resolve()
    s.onerror = () => {
      // Let the next caller try again rather than caching a permanent failure.
      pending = null
      reject(new Error("PayPal failed to load."))
    }
    document.body.appendChild(s)
  })

  return pending
}

/** Google Pay's own SDK, which is separate from PayPal's and safe to load alone. */
export function loadGooglePaySdk(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.payments?.api) return resolve()
    const existing = document.querySelector<HTMLScriptElement>('script[data-yd="yd-googlepay-sdk"]')
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error("Google Pay failed to load.")))
      return
    }
    const s = document.createElement("script")
    s.src = "https://pay.google.com/gp/p/js/pay.js"
    s.dataset.yd = "yd-googlepay-sdk"
    s.onload = () => resolve()
    s.onerror = () => reject(new Error("Google Pay failed to load."))
    document.body.appendChild(s)
  })
}
