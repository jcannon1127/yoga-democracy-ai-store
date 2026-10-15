/**
 * Welcome / first-order discount email.
 *
 * **Modelled on the live send** ("Welcome to the YD Fam!", SFMC), which carries a **unique
 * per-subscriber code** — `welcome-4AZZ-MMZS-HOP9-W4T3` — not the shared `SFwelcome15` that
 * appears in order data. Both exist; they are different codes doing different jobs.
 *
 * **The capture and the send are in different systems today:** Klaviyo hosts the signup form
 * (account `bViWbF`, form `U2Y3jE`) and SFMC sends this email. Klaviyo is verified on the
 * domain and absent from SPF, so it cannot send as yogademocracy.com.
 */
import { shell, button, esc, INK, MUTED, RULE, PANEL } from "./layout.ts"

export type WelcomeData = {
  /**
   * The discount code for THIS subscriber.
   *
   * **Required, with no fallback and no default.** A welcome email that promises a discount
   * and carries a code that does not work is worse than sending nothing: the customer reaches
   * checkout, is refused, and their first experience of YD is being told no. If the code
   * cannot be issued, **do not send this email** — see `renderWelcome` returning null.
   */
  code: string
  /** From the promotion record, never from the copy. If the promotion changes to 20% and this
   *  says 15%, YD has advertised a discount it does not honour. */
  percent: number
  shop_url: string
}

export function subject(d: Pick<WelcomeData, "percent">): string {
  return `Welcome to Yoga Democracy — ${d.percent}% off your first order`
}

export function preheader(d: Pick<WelcomeData, "percent">): string {
  return `Your ${d.percent}% welcome code is inside.`
}

/**
 * Returns `null` when there is nothing valid to send.
 *
 * **This is deliberately different from the backorder note, which renders nothing and carries
 * on.** There, a missing line leaves a correct email slightly less informative. Here, the code
 * IS the email — without it the message is a promise YD cannot keep. **The right failure is to
 * not send, loudly, so someone notices a subscriber never got their code** — rather than to
 * send a broken one, which nobody would ever notice.
 */
export function renderWelcome(d: WelcomeData): string | null {
  if (!d.code?.trim()) return null
  if (!Number.isFinite(d.percent) || d.percent <= 0) return null

  const content = `
  <tr><td class="pad" style="padding:26px 24px 8px;text-align:center;
      font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:${INK};">
    <p style="margin:0;">Here's ${esc(d.percent)}% off your first order, just for joining us.</p>
  </td></tr>

  <tr><td class="pad" style="padding:14px 24px 6px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="border:1px dashed ${RULE};background:${PANEL};">
      <tr><td align="center" style="padding:18px 16px;font-family:Inter,Helvetica,Arial,sans-serif;">
        <div style="text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;
          color:${MUTED};margin-bottom:8px;">Your welcome code</div>
        <!-- A code must never orphan a character onto its own line: at 19px with
             word-break:break-all this rendered "…HOP9-W4T" / "3", which is easy to
             mis-transcribe. Break only between hyphen groups, and size it to fit 390px. -->
        <div style="font-family:'Courier New',Courier,monospace;font-size:16px;font-weight:700;
          letter-spacing:.5px;color:${INK};word-break:normal;overflow-wrap:break-word;">${esc(d.code)}</div>
        <div style="font-size:13px;color:${MUTED};margin-top:8px;">
          ${esc(d.percent)}% off your first order</div>
      </td></tr>
    </table></td></tr>

  <tr><td align="center" style="padding:18px 24px 24px;">${button(d.shop_url, "Shop now")}</td></tr>

  <tr><td class="pad" style="padding:0 24px 26px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:14px;line-height:22px;color:${MUTED};">
    <div style="border-top:1px solid ${RULE};padding-top:16px;">
      Every piece is made in our own facility in Nairobi, Kenya, using low-impact processes —
      including a waterless dye technique that saves thousands of gallons compared with
      traditional textile manufacturing.
    </div>
  </td></tr>`

  return shell({
    title: subject(d),
    preheader: preheader(d),
    headline: "Welcome to the fam.",
    content,
  })
}
