/**
 * Shared chrome for every transactional email.
 *
 * **One shell, so the confirmation and the reset cannot drift apart.** They are the two
 * highest-volume messages YD sends and they must look like the same company. Duplicating the
 * header and footer into each template is how one of them silently keeps an old logo, an old
 * footer address, or an old brand colour.
 */

/** Brand green. The value of `--yd-primary` in storefront/src/styles/globals.css.
 *  Email clients do not support CSS custom properties, so the literal is unavoidable — but it
 *  MUST track that token. Confirmed against a real SFCC send: the existing password-reset
 *  email already uses exactly this hex, so it is what customers are used to seeing. */
export const YD_PRIMARY = "#5e7461"
export const INK = "#111827"
export const MUTED = "#374151"
export const RULE = "#cfcfcf"
export const PANEL = "#eeede9"
export const HEADER_BG = "#dce6dd"

/** Escape before interpolation. Names, addresses and email addresses arrive raw. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export type ShellOpts = {
  title: string
  /**
   * Inbox preview text.
   *
   * **Never put a credential or an order's contents here.** The preheader is rendered by the
   * mail client in list view, next to the subject, where it is visible without opening the
   * message and is captured in notification popups on a lock screen.
   */
  preheader: string
  headline: string
  /** Small uppercase line under the headline. Order number and date, or nothing. */
  kicker?: string
  /** Body HTML — table rows, `<tr><td>…</td></tr>`. */
  content: string
}

export function shell(o: ShellOpts): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(o.title)}</title>
<style>
  @media only screen and (max-width:600px){
    .container{width:100% !important}
    .pad{padding-left:16px !important;padding-right:16px !important}
    .stack{display:block !important;width:100% !important;max-width:100% !important;padding:0 0 16px !important}
  }
</style></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.preheader)}</div>
<center style="width:100%;background:#f4f4f4;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0"
  style="width:600px;max-width:600px;background:#ffffff;overflow:hidden;">

  <tr><td align="center" style="padding:28px 0 18px;">
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:26px;color:${INK};">Yoga Democracy</div>
  </td></tr>

  <tr><td style="background:${HEADER_BG};padding:26px 24px;text-align:center;
      font-family:'Playfair Display',Georgia,serif;color:#2f493a;">
    <div style="font-size:40px;line-height:46px;">${esc(o.headline)}</div>
    ${o.kicker ? `<div style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;
      letter-spacing:.06em;font-weight:700;font-size:13px;margin-top:6px;">${o.kicker}</div>` : ""}
  </td></tr>

  ${o.content}

  <tr><td style="border-top:1px solid ${RULE};background:${PANEL};padding:18px 24px;text-align:center;
      font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:${MUTED};">
    Questions? Reply to this email or write to
    <a href="mailto:cs@yogademocracy.com" style="color:${YD_PRIMARY};">cs@yogademocracy.com</a>.
  </td></tr>

</table></td></tr></table></center></body></html>`
}

/** Primary call to action. One definition, so both emails get the same button. */
export function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${YD_PRIMARY};
     color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:25px;
     font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;">${esc(label)}</a>`
}
