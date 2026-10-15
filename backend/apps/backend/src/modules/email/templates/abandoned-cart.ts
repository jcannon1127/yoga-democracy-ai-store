/**
 * Abandoned cart — a THREE-EMAIL series, 24 hours apart.
 *
 * **Not one email.** Measured from four complete cycles of real SFMC sends in August 2026:
 *
 *     step 1  "Did Something Catch Your Eye? 👀"   Aug 19 17:12:07
 *     step 2  "15% Off Your Cart 🛒"               Aug 20 17:13:08
 *     step 3  "Your Discount Expires Soon ⏳"       Aug 21 17:14:07
 *
 * 24 hours plus about a minute between steps every time, and **re-entrant** — it re-fires on
 * each new abandonment rather than once per person.
 *
 * **The discount mechanism is behind a seam, deliberately.** The live emails carry NO code in
 * the body, so the offer either rides on the cart link or the customer is assumed to hold one
 * already; yd-promo is settling which from order adjustments. `offer` covers all three
 * answers, and **when there is no offer the copy must not claim one** — which is the whole
 * reason steps 2 and 3 have discount-free variants rather than a hardcoded "15%".
 */
import { shell, button, esc, INK, MUTED, RULE, PANEL, YD_PRIMARY } from "./layout.ts"
import { formatDay, isRealDate } from "./dates.ts"

export type CartLine = {
  title: string
  options?: string[]
  thumbnail?: string | null
  quantity: number
  unit_price: number
}

export type AbandonedCartData = {
  /** Often absent — most abandoned carts are guests. Copy must read without it. */
  customer_name?: string
  items: CartLine[]
  currency_code: string
  /** Restores the cart. If the offer rides on the link, it rides on THIS link. */
  cart_url: string
  step: 1 | 2 | 3
  /**
   * The seam. `undefined` means no offer could be attached — and then **no step may promise
   * one.** `code` absent with `percent` present means the discount is applied by the link.
   */
  offer?: {
    percent: number
    code?: string
    /**
     * When the discount actually stops working, if it ever does.
     *
     * **Every "expires soon" in this template is gated on this field, because YD is currently
     * living the alternative.** The live SFCC series heads step 3 *"Your Discount Expires
     * Soon"* while the code behind it — `CHECKOUT15` — has had no redemption since
     * 2026-06-05. Urgency copy with nothing enforcing it is a false statement to a customer
     * who has already engaged, which is the exact failure this lane exists to prevent.
     *
     * **An unparseable date behaves EXACTLY like no date, never as a silent third state** —
     * the gap a surviving mutation found in the gift certificate, which said "spend it
     * whenever you like" and "use it by January 15" in the same email.
     */
    expires_at?: string
  }
}

/** True only for a date that actually resolves to a calendar day. See the note on `expires_at`. */
function hasExpiry(d: Pick<AbandonedCartData, "offer">): boolean {
  return isRealDate(d.offer?.expires_at)
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
    .format(minor / 100)
}

export function subject(d: Pick<AbandonedCartData, "step" | "offer">): string {
  const pct = d.offer?.percent
  if (d.step === 1) return "Did something catch your eye?"
  if (d.step === 2) return pct ? `${pct}% off your cart` : "Your cart is still waiting"
  if (!pct) return "Last chance on your cart"
  return hasExpiry(d) ? `Your ${pct}% discount expires soon` : `Last chance: ${pct}% off your cart`
}

export function preheader(d: Pick<AbandonedCartData, "step" | "offer">): string {
  // Never the cart contents: this is visible in list view and on lock screens.
  if (d.step === 1) return "Your picks are waiting."
  if (d.step === 2) return d.offer?.percent
    ? `Finish checking out and save ${d.offer.percent}%.` : "Don't leave these behind."
  if (!d.offer?.percent) return "These are still in your cart."
  return hasExpiry(d) ? "Your discount is about to expire." : "Your discount is still here."
}

function headline(d: AbandonedCartData): string {
  if (d.step === 1) return "Still thinking it over?"
  if (d.step === 2) return d.offer?.percent ? "Here's a nudge." : "Still in your cart."
  return d.offer?.percent ? "Last chance." : "Still here."
}

function lines(items: CartLine[], currency: string): string {
  return items.map((l) => {
    const img = l.thumbnail
      ? `<td width="80" style="width:80px;vertical-align:top;padding-right:14px;">
           <img src="${esc(l.thumbnail)}" width="80" alt="${esc(l.title)}"
             style="display:block;border-radius:4px;width:80px;max-width:80px;height:auto;"></td>`
      : ""
    const qty = l.quantity > 1 ? `${esc(l.quantity)} &times; ` : ""
    return `<tr><td style="padding:10px 16px;border-top:1px solid ${RULE};">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
        ${img}
        <td style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:${INK};">
          <div style="font-weight:600;">${esc(l.title)}</div>
          <div style="color:${MUTED};">${(l.options ?? []).map((o) => `${esc(o)}<br/>`).join("")}
            ${qty}${esc(money(l.unit_price, currency))}</div>
        </td>
      </tr></table></td></tr>`
  }).join("")
}

/**
 * Returns `null` when there is nothing to remind anyone about.
 *
 * An empty cart, or no way back to it, makes this email a message with no purpose and a
 * button that goes nowhere.
 */
export function renderAbandonedCart(d: AbandonedCartData): string | null {
  if (!Array.isArray(d.items) || d.items.length === 0) return null
  if (!d.cart_url?.trim()) return null
  if (![1, 2, 3].includes(d.step)) return null

  const pct = d.offer?.percent
  const greeting = d.customer_name
    ? `<p style="margin:0 0 12px;">Hey ${esc(d.customer_name)},</p>` : ""

  const pitch = d.step === 1
    // **No stock claim.** This said "and still in your size" until it was read out loud:
    // nothing in this journey checks availability, and step 3 goes out three days later, by
    // which time the size may well be gone. An unverifiable promise to someone who has
    // already engaged is precisely what this lane exists to prevent — and it was ours.
    ? "You left these behind. Pick up right where you left off."
    : pct
      ? "Still thinking? Here's a reason to stop thinking."
      : "These are still in your cart."

  /** Only ever rendered when an offer actually exists. */
  const offerBlock = pct
    ? `<tr><td class="pad" style="padding:14px 24px 4px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="border:1px dashed ${RULE};background:${PANEL};">
          <tr><td align="center" style="padding:16px;font-family:Inter,Helvetica,Arial,sans-serif;">
            <div style="text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;
              color:${MUTED};">${d.step === 3 && hasExpiry(d) ? "Expiring soon" : "Your discount"}</div>
            <div style="font-size:22px;font-weight:700;color:${YD_PRIMARY};margin-top:6px;">
              ${esc(pct)}% off your cart</div>
            ${d.offer?.code
              ? `<div style="font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:700;
                   color:${INK};margin-top:8px;word-break:normal;overflow-wrap:break-word;">${esc(d.offer.code)}</div>`
              : `<div style="font-size:13px;color:${MUTED};margin-top:6px;">Applied automatically at checkout.</div>`}
            ${hasExpiry(d)
              ? `<div style="font-size:13px;color:${MUTED};margin-top:8px;">Use it by ${esc(formatDay(d.offer?.expires_at)!)}.</div>`
              : ""}
          </td></tr>
        </table></td></tr>`
    : ""

  const content = `
  <tr><td class="pad" style="padding:24px 24px 4px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:15px;line-height:23px;color:${INK};">
    ${greeting}
    <p style="margin:0;">${esc(pitch)}</p>
  </td></tr>

  ${offerBlock}

  <tr><td align="center" style="padding:18px 24px 18px;">
    ${button(d.cart_url, d.step === 3 ? "Complete your order" : "Back to your cart")}</td></tr>

  <tr><td class="pad" style="padding:0 24px 24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="border:1px solid ${RULE};">
      <tr><td style="background:${PANEL};padding:12px 18px;font-family:'Playfair Display',Georgia,serif;
        font-size:16px;color:${INK};">In your cart</td></tr>
      ${lines(d.items, d.currency_code)}
    </table></td></tr>`

  return shell({
    title: subject(d),
    preheader: preheader(d),
    headline: headline(d),
    content,
  })
}
