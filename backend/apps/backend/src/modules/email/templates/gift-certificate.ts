/**
 * Gift certificate delivery.
 *
 * **The sharpest silent failure in this lane, and the reason the lane exists.** The customer
 * pays, the recipient gets nothing, and nothing errors anywhere: no bounce, no exception, no
 * angry customer until a birthday passes. $39,212 issued all time, $31,775 of it since
 * November 2025 — so most of it is recent and plausibly unspent.
 *
 * **PARITY IS NOT VERIFIED AND I AM SAYING SO RATHER THAN IMPLYING IT.** I could not establish
 * what the live SFCC email looks like: no gift-certificate delivery email exists anywhere in
 * Jeff's mailbox (he is not a recipient), there is no SFCC export on this box, and Business
 * Manager access is outstanding. **This template is designed from the requirement, not copied
 * from the original.** A single test send by Jeff settles it, and until then the copy is a
 * proposal — the *contract* and the *refusal behaviour* are the parts I stand behind.
 *
 * **Two things distinguish this from every other email here:**
 * 1. **It goes to someone who did not buy anything** and may never have heard of YD. It has to
 *    say who sent it and why, or it reads as spam and gets deleted with the money inside it.
 * 2. **It IS the product.** Elsewhere a failed send costs information; here it costs the whole
 *    purchase. So `renderGiftCertificate` refuses far more readily than the others.
 */
import { shell, button, esc, INK, MUTED, RULE, PANEL, YD_PRIMARY } from "./layout.ts"
import { formatDay, isRealDate } from "./dates.ts"

export type GiftCertificateData = {
  /** Who it is going to. Not the buyer. */
  recipient_name?: string
  recipient_email: string
  /** Shown prominently — without it the email is from a stranger. */
  sender_name: string
  /** Optional note from the buyer. Free text, escaped. */
  message?: string
  /** Minor units, matching Medusa. */
  amount: number
  currency_code: string
  /** The code that carries the money. */
  code: string
  /** Where to spend it. */
  shop_url: string
  /** ISO date, when it is known. Never invented — see the expiry rule below. */
  expires_at?: string
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
    .format(minor / 100)
}

export function subject(d: Pick<GiftCertificateData, "sender_name">): string {
  return `${d.sender_name} sent you a Yoga Democracy gift card`
}

/** Names the sender, never the amount — this is visible on a lock screen beside the recipient. */
export function preheader(d: Pick<GiftCertificateData, "sender_name">): string {
  return `A gift from ${d.sender_name}, with a code inside.`
}

/**
 * Returns `null` rather than sending something worthless.
 *
 * **The refusal list is longer here on purpose.** Everywhere else a missing field costs
 * information; here a gift card with no code, no value, or no sender is a message that has
 * taken someone's money and delivered nothing. **Better it never arrives and the detector
 * screams than that it arrives empty and nobody notices.**
 */
export function renderGiftCertificate(d: GiftCertificateData): string | null {
  if (!d.code?.trim()) return null
  if (!Number.isFinite(d.amount) || d.amount <= 0) return null
  if (!d.sender_name?.trim()) return null
  if (!d.recipient_email?.trim()) return null
  if (!d.shop_url?.trim()) return null

  const greeting = d.recipient_name
    ? `<p style="margin:0 0 12px;">Hi ${esc(d.recipient_name)},</p>` : ""

  const note = d.message?.trim()
    ? `<tr><td class="pad" style="padding:0 24px 18px;">
        <div style="border-left:3px solid ${YD_PRIMARY};padding:8px 0 8px 14px;
          font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;
          line-height:23px;color:${INK};">${esc(d.message.trim())}</div>
        <div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;color:${MUTED};
          margin-top:8px;">— ${esc(d.sender_name)}</div></td></tr>`
    : ""

  /**
   * Only ever rendered from a real date. An invented expiry on money is indefensible.
   *
   * **And it gates the body copy.** Found by rendering it: the line "the code below is yours to
   * spend whenever you like" sat directly above "Use it by January 15" — the email contradicting
   * itself about whether the money runs out. Neither test nor markup showed it; looking did.
   */
  const hasExpiry = isRealDate(d.expires_at)
  const expiry = d.expires_at && !Number.isNaN(Date.parse(d.expires_at))
    // Shared with the abandoned-cart offer, one rule and one implementation: Eastern time,
    // and a bare `YYYY-MM-DD` means that calendar day rather than midnight UTC — which in ET
    // is the evening BEFORE, so a date-only expiry used to read a day early.
    ? `<div style="font-size:13px;color:${MUTED};margin-top:10px;">Use it by ${
        esc(formatDay(d.expires_at, { year: true })!)}.</div>`
    : ""

  const content = `
  <tr><td class="pad" style="padding:24px 24px 4px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:15px;line-height:23px;color:${INK};">
    ${greeting}
    <p style="margin:0;"><strong>${esc(d.sender_name)}</strong> sent you a Yoga Democracy gift
      card.${hasExpiry ? "" : " The code below is yours to spend whenever you like."}</p>
  </td></tr>

  ${note}

  <tr><td class="pad" style="padding:14px 24px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="border:1px dashed ${RULE};background:${PANEL};">
      <tr><td align="center" style="padding:20px 16px;font-family:Inter,Helvetica,Arial,sans-serif;">
        <div style="font-size:34px;font-weight:700;color:${YD_PRIMARY};line-height:40px;">
          ${esc(money(d.amount, d.currency_code))}</div>
        <div style="text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;
          color:${MUTED};margin-top:10px;">Your gift card code</div>
        <div style="font-family:'Courier New',Courier,monospace;font-size:16px;font-weight:700;
          letter-spacing:.5px;color:${INK};margin-top:6px;
          word-break:normal;overflow-wrap:break-word;">${esc(d.code)}</div>
        ${expiry}
      </td></tr>
    </table></td></tr>

  <tr><td align="center" style="padding:18px 24px 22px;">${button(d.shop_url, "Start shopping")}</td></tr>

  <tr><td class="pad" style="padding:0 24px 26px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:13px;line-height:20px;color:${MUTED};">
    <div style="border-top:1px solid ${RULE};padding-top:14px;">
      Enter the code at checkout. Keep this email — the code is the card, and we cannot look it
      up for you once it has been issued.
    </div>
  </td></tr>`

  return shell({
    title: subject(d),
    preheader: preheader(d),
    headline: "Someone's thinking of you.",
    content,
  })
}
