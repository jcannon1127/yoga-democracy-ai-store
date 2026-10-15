/**
 * Password reset email.
 *
 * **Built against yd-accounts' seam**, which emits on `auth.password_reset` with
 * `template: "password-reset"`, `channel: "email"` and
 * `data: { reset_url, email, token_expires_minutes }`.
 *
 * **This is not a rare system email and must not look like one.** SFCC password hashes are not
 * portable, so every YD customer resets at cutover — this is the highest-volume transactional
 * send of the migration, going to the whole base in one window. It shares `shell()` with the
 * order confirmation deliberately: a customer who has just been forced out of their account
 * needs to recognise the brand instantly, not wonder whether they are being phished.
 *
 * **It also has history.** Today's reset is SFCC's own (`cs@yogademocracy.com`, JavaMail via
 * outgoing.POD287.demandware.net, link to `/setpassword?Token=…`) and in November 2025 multiple
 * customers reported never receiving it; the thread reached the dev agency and was never closed.
 * Whatever that was, it is the failure mode to design against: **a customer who cannot reset
 * cannot buy.**
 */
import { shell, button, esc, YD_PRIMARY, INK, MUTED, RULE } from "./layout.ts"

export type PasswordResetData = {
  /** Fully built by yd-accounts from STOREFRONT_URL + RESET_PASSWORD_PATH.
   *  **Render as-is.** Reassembling it here would put the origin in two places. */
  reset_url: string
  email: string
  /** Absent means "not supplied", NOT "no expiry" — the sentence is omitted rather than guessed. */
  token_expires_minutes?: number
}

export function subject(): string {
  return "Reset your Yoga Democracy password"
}

/**
 * **The preheader must not contain the link, the token, or the email address.** It is shown in
 * list view and on lock screens without the message being opened.
 */
export function preheader(): string {
  return "A link to set a new password, and what to do if it wasn't you."
}

export function renderPasswordReset(d: PasswordResetData): string {
  const expiry = typeof d.token_expires_minutes === "number" && d.token_expires_minutes > 0
    ? `<p style="margin:0 0 14px;">For your security this link expires in
         <strong>${esc(d.token_expires_minutes)} minutes</strong>. If it has expired, just ask for
         a new one from the sign-in page.</p>`
    : ""

  const content = `
  <tr><td class="pad" style="padding:26px 24px 6px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:15px;line-height:23px;color:${INK};">
    <p style="margin:0 0 14px;">Someone asked to reset the password for the Yoga Democracy account
      registered to <strong>${esc(d.email)}</strong>.</p>
    <p style="margin:0 0 4px;">If that was you, set a new one here:</p>
  </td></tr>

  <tr><td align="center" style="padding:14px 24px 18px;">${button(d.reset_url, "Set a new password")}</td></tr>

  <tr><td class="pad" style="padding:0 24px 6px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:15px;line-height:23px;color:${INK};">
    ${expiry}
    <p style="margin:0 0 14px;color:${MUTED};">
      <strong style="color:${INK};">If it wasn't you, you can ignore this email.</strong>
      Your password has not changed and nobody can change it without the link above.</p>
  </td></tr>

  <tr><td class="pad" style="padding:6px 24px 26px;">
    <div style="border-top:1px solid ${RULE};padding-top:14px;
        font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:${MUTED};
        word-break:break-all;">
      If the button doesn't work, paste this into your browser:<br/>
      <a href="${esc(d.reset_url)}" style="color:${YD_PRIMARY};">${esc(d.reset_url)}</a>
    </div>
  </td></tr>`

  return shell({
    title: subject(),
    preheader: preheader(),
    headline: "Let's get you back in.",
    content,
  })
}
