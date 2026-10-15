/**
 * The customer's TENDER choice, which is finer-grained than the payment provider.
 *
 * Cards ride PayPal as a funding source: one provider, one session, one order. But the payment
 * list shows "Credit card" and "PayPal" as peers, because that is what the live site shows and
 * because a customer who wants to pay by card should not have to know that cards live inside
 * PayPal. The list therefore carries a display id with a `:card` suffix.
 *
 * **Nothing except the UI may ever see that suffix.** `pp_paypal_paypal:card` is not a provider
 * id; sending it to Medusa creates no session and fails in a way that looks like PayPal being
 * broken. Strip it with `providerOf()` at every boundary.
 */
export const CARD_TENDER = "card"

const CARD_SUFFIX = `:${CARD_TENDER}`

/** The real Medusa provider id behind a display id. */
export const providerOf = (displayId?: string) =>
  (displayId ?? "").replace(CARD_SUFFIX, "")

/**
 * Whether this means "the card fields" rather than the PayPal button.
 *
 * Accepts BOTH vocabularies on purpose: the list's display id (`pp_paypal_paypal:card`) and
 * the review step's URL value (`tender=card`). They are different strings for the same
 * choice, and a helper that understands only one is a silent wrong answer — yd-pay's parallel
 * implementation had exactly this: its `modeOf()` parsed only the suffixed form while the
 * query parameter carried the bare one, so the card form did not render and it read as the
 * component being broken rather than the parser. Nothing here passes the URL value in today;
 * this is so that the day something does, it works.
 */
export const isCardTender = (value?: string) => {
  const v = value ?? ""
  return v === CARD_TENDER || v.endsWith(CARD_SUFFIX)
}
