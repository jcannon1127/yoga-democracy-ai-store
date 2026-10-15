/**
 * Template registry — the piece that turns a `template` id into a real message.
 *
 * **This is the gap yd-accounts' subscriber names.** It builds a notification with
 * `template: "password-reset"` and hands it to the Notification module; without something
 * that knows what that id *means*, the local provider logs a line and no email exists.
 * Four finished templates and no registry is four templates nobody can send.
 *
 * **Three outcomes, deliberately, because they are three different things:**
 *   `send`    — rendered, deliver it.
 *   `skip`    — rendered to nothing ON PURPOSE, with a reason. NOT a failure.
 *   (throw)   — unknown template or unusable data. A wiring fault, and it must be loud.
 *
 * The `skip` case is not a nicety. `renderWelcome` returns null when no code was issued and
 * `renderShipmentNotice` returns null for a voided label — both are correct refusals, and
 * both would be indistinguishable from a crash if this collapsed them into an error, or from
 * a successful send if it collapsed them into `send`.
 */
import { renderOrderConfirmation, subject as orderSubject,
  type ConfirmationOrder } from "./templates/order-confirmation.ts"
import { renderPasswordReset, subject as resetSubject,
  type PasswordResetData } from "./templates/password-reset.ts"
import { renderWelcome, subject as welcomeSubject, type WelcomeData } from "./templates/welcome.ts"
import { renderShipmentNotice, subject as shipmentSubject,
  type ShipmentNoticeData } from "./templates/shipment-notice.ts"
import { renderAbandonedCart, subject as cartSubject,
  type AbandonedCartData } from "./templates/abandoned-cart.ts"
import { renderGiftCertificate, subject as giftSubject,
  type GiftCertificateData } from "./templates/gift-certificate.ts"

export type Rendered =
  | { outcome: "send"; subject: string; html: string }
  | { outcome: "skip"; reason: string }

export class UnknownTemplateError extends Error {
  constructor(id: string) {
    super(`unknown email template ${JSON.stringify(id)} — nothing will be sent. ` +
      `Known: ${Object.keys(TEMPLATES).join(", ")}`)
    this.name = "UnknownTemplateError"
  }
}

type Renderer = (data: Record<string, unknown>) => Rendered

export const TEMPLATES: Record<string, Renderer> = {
  "order-confirmation": (d) => {
    const o = d as unknown as ConfirmationOrder
    return { outcome: "send", subject: orderSubject(o), html: renderOrderConfirmation(o) }
  },

  "password-reset": (d) => {
    const p = d as unknown as PasswordResetData
    // No URL means the subscriber could not build a link. Sending a reset email with no way
    // to reset is worse than sending nothing: the customer believes help is on the way.
    if (!p.reset_url?.trim()) return { outcome: "skip", reason: "no reset_url supplied" }
    return { outcome: "send", subject: resetSubject(), html: renderPasswordReset(p) }
  },

  welcome: (d) => {
    const w = d as unknown as WelcomeData
    const html = renderWelcome(w)
    if (!html) {
      return { outcome: "skip",
        reason: "no usable discount code or percent — a welcome offer that cannot be redeemed" }
    }
    return { outcome: "send", subject: welcomeSubject(w), html }
  },

  "gift-certificate": (d) => {
    const g = d as unknown as GiftCertificateData
    const html = renderGiftCertificate(g)
    if (!html) {
      // Named precisely: whoever reads this log line is looking at money that did not arrive.
      const why = !g.code?.trim() ? "no code"
        : !(Number.isFinite(g.amount) && g.amount > 0) ? "no usable amount"
        : !g.sender_name?.trim() ? "no sender name"
        : !g.recipient_email?.trim() ? "no recipient" : "no shop url"
      return { outcome: "skip", reason: `gift certificate not sendable: ${why}` }
    }
    return { outcome: "send", subject: giftSubject(g), html }
  },

  /** One id, three steps — `data.step` selects. The journey timing is the caller's. */
  "abandoned-cart": (d) => {
    const c = d as unknown as AbandonedCartData
    const html = renderAbandonedCart(c)
    if (!html) {
      return { outcome: "skip",
        reason: !c.items?.length ? "cart is empty"
          : !c.cart_url ? "no cart url" : `step ${String(c.step)} is not 1, 2 or 3` }
    }
    return { outcome: "send", subject: cartSubject(c), html }
  },

  "shipment-notice": (d) => {
    const s = d as unknown as ShipmentNoticeData
    const html = renderShipmentNotice(s)
    if (!html) {
      return { outcome: "skip",
        reason: s.voided ? "label was voided" : "no tracking number" }
    }
    return { outcome: "send", subject: shipmentSubject(s), html }
  },
}

/** Render by template id. Throws on an unknown id — never silently produces nothing. */
export function render(templateId: string, data: Record<string, unknown>): Rendered {
  const r = TEMPLATES[templateId]
  if (!r) throw new UnknownTemplateError(templateId)
  return r(data ?? {})
}

export function knownTemplates(): string[] {
  return Object.keys(TEMPLATES)
}
