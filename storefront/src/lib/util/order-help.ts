import orderHelp from "../../content/order-help.json"

/**
 * The route to a human when the site cannot find someone's order.
 *
 * Kept in one place because it is used from two surfaces that must not drift apart: the guest
 * lookup, and the signed-in order history where an unlinked order simply is not listed. A
 * customer who fails to find an order as a guest and then signs in and still cannot see it must
 * meet the same offer, not two differently-worded dead ends.
 */

export const orderHelpContent = orderHelp

/**
 * A prefilled mailto, so the handoff is one tap and the reply is useful first time.
 *
 * IT PREFILLS ONLY WHAT THE CUSTOMER THEMSELVES TYPED. That is what keeps it compatible with
 * the identical-response rule: the link is built from the form's own values and is byte-for-byte
 * the same shape whether or not the order exists. It reveals nothing, because it knows nothing.
 *
 * The point is the reply. Without this, a customer sends "where is my order" and customer
 * service spends two exchanges collecting the order number and the address it went to — for a
 * population of roughly 1 in 9 orders that will never be self-serviceable.
 */
export function buildOrderHelpMailto(input?: {
  orderNumber?: string
  email?: string
}): string {
  const t = orderHelp.email_template
  const lines = [t.intro, ""]

  if (input?.orderNumber) lines.push(`Order number: ${input.orderNumber}`)
  if (input?.email) lines.push(`Email I ordered with: ${input.email}`)
  if (input?.orderNumber || input?.email) lines.push("")

  lines.push(t.ask)

  const subject = input?.orderNumber
    ? `${t.subject} (${input.orderNumber})`
    : t.subject

  return (
    `mailto:${orderHelp.contact_email}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(lines.join("\n"))}`
  )
}
