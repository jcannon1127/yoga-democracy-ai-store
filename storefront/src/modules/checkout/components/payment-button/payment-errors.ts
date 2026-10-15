/**
 * What a customer is allowed to be shown when a payment goes wrong, and what a
 * "failure" is not.
 *
 * TWO THINGS MEASURED IN A REAL CHECKOUT, both from rendering `e.message`:
 *
 * 1. A mistyped card number put PayPal's raw HTTP 422 body on the page --
 *    order id, `Corr ID`, `debug_id` and a link to developer.paypal.com.
 * 2. **A SUCCESSFUL payment flashed `NEXT_REDIRECT` at the customer.** Next's
 *    server actions signal a redirect by THROWING, so `placeOrder()` resolving
 *    correctly still lands in `catch`. The order was created; the shopper was
 *    told something had gone wrong on the way to the confirmation page.
 *
 * The second is the nastier of the two: an error message on a payment that
 * WORKED teaches a customer to retry, and a retry after a successful payment is
 * how you get a double order.
 */

/** Next signals navigation by throwing. That is not a payment failure. */
export function isRedirectSignal(e: unknown): boolean {
  const s = String((e as any)?.message ?? e ?? "")
  const digest = String((e as any)?.digest ?? "")
  return (
    s.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_REDIRECT") ||
    s === "NEXT_NOT_FOUND"
  )
}

/**
 * Plain English naming the field the customer can actually fix. Where the
 * gateway has not said which field is wrong, this does not guess -- telling
 * someone their card was declined when it was a typo sends them to a different
 * card for no reason.
 */
export function customerMessage(raw: unknown): string {
  const text = String((raw as any)?.message ?? raw ?? "")
  const has = (s: string) => text.toUpperCase().includes(s)

  if (has("INVALID_EXPIRY") || has("CARD_EXPIRED") || has("/CARD/EXPIRY")) {
    return "That expiry date looks wrong, or the card has expired. Please check it and try again."
  }
  if (has("/CARD/NUMBER") || has("INVALID_NUMBER")) {
    return "That card number doesn't look right. Please check it and try again."
  }
  if (has("/CARD/SECURITY_CODE") || has("INVALID_SECURITY_CODE") || has("CVV")) {
    return "That security code doesn't look right. It's the 3 digits on the back of the card."
  }
  if (has("INVALID_BILLING_ADDRESS") || has("POSTAL")) {
    return "The billing address doesn't match the card. Please check the postcode and try again."
  }
  // THE PAYMENT WORKED. Do not invite a third attempt.
  //
  // PayPal refuses a second capture on an order it has already captured --
  // measured: 422 UNPROCESSABLE_ENTITY / ORDER_ALREADY_CAPTURED, and still
  // exactly one capture of the original amount. So there is no double charge.
  // But the generic message ("check the details and try again") is the worst
  // possible thing to show someone whose money HAS been taken: it reads as a
  // failure, invites another attempt, and produces a support call about a
  // charge that is perfectly fine.
  if (has("ALREADY_CAPTURED") || has("ORDER_ALREADY") || has("DUPLICATE")) {
    return "This order has already been paid. Please check your email for the confirmation before trying again."
  }
  if (has("INSUFFICIENT_FUNDS")) {
    return "The card was declined. Please try a different card."
  }
  if (has("DECLINE") || has("DENIED")) {
    return "The card was declined. Please try a different card, or contact your bank."
  }
  return "We couldn't process that payment. Please check the details and try again."
}
