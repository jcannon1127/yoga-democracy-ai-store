/**
 * Where the abandoned-cart discount comes from — and the refusal that keeps it honest.
 *
 * **YD's live abandoned-cart series is, on the best evidence this fleet has, promising a
 * discount that nothing has redeemed since 2026-06-05.** `CHECKOUT15` — exactly 15.0%, 17
 * uses, then eighty days of silence at odds of about 3.4 x 10^-6 — and from this side, the
 * emails carry no code in their plain-text part while the welcome email from the same system
 * shows its code perfectly. Steps 2 and 3 are still headed *"Your Discount Expires Soon"*.
 *
 * **Had this been rebuilt by copying the live emails, the rebuild would have reproduced that
 * defect faithfully.** So the percent is never a literal in a template: it is resolved here,
 * and when it cannot be resolved the template promises nothing rather than something false.
 *
 * **A percent with no code is allowed only when somebody says so explicitly.** It is a real
 * configuration — an offer can ride on the cart link — but it is indistinguishable from
 * "somebody set the percent and forgot the code", and that mistake produces exactly the email
 * this lane exists to prevent: a promise the customer cannot act on.
 */
export type Offer = { percent: number; code?: string }

export type OfferResolution =
  | { state: "offer"; offer: Offer; detail: string }
  | { state: "none"; detail: string }

export function resolveOffer(env: Record<string, string | undefined>): OfferResolution {
  const rawPercent = env.ABANDONED_CART_OFFER_PERCENT?.trim()
  const code = env.ABANDONED_CART_OFFER_CODE?.trim()
  const linkBorne = env.ABANDONED_CART_OFFER_LINK_BORNE?.trim().toLowerCase() === "true"

  if (!rawPercent) {
    return { state: "none",
      detail: code
        ? `ABANDONED_CART_OFFER_CODE is set to ${code} but no percent — an offer of an unknown ` +
          `size cannot be described, so no discount is promised`
        : "no offer configured — the emails will promise no discount" }
  }

  const percent = Number(rawPercent)
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    return { state: "none",
      detail: `ABANDONED_CART_OFFER_PERCENT=${JSON.stringify(rawPercent)} is not a usable ` +
        `percentage — promising nothing rather than promising nonsense` }
  }

  if (!code) {
    if (!linkBorne) {
      return { state: "none",
        detail: `a ${percent}% offer is configured with NO CODE. If the discount really rides ` +
          `on the cart link, set ABANDONED_CART_OFFER_LINK_BORNE=true to say so deliberately. ` +
          `Until then no discount is promised, because a percent with a forgotten code is the ` +
          `same email as a percent with a dead one.` }
    }
    return { state: "offer", offer: { percent },
      detail: `${percent}% carried by the cart link (declared link-borne)` }
  }

  return { state: "offer", offer: { percent, code },
    detail: `${percent}% via code ${code} — NOTE: nothing here proves it is redeemable. ` +
      `CHECKOUT15 looked exactly like this until it stopped working.` }
}
