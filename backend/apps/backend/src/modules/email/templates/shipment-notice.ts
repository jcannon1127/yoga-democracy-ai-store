/**
 * Shipment notice — "your parcel is on the way".
 *
 * **This is per SHIPMENT, not per order, and that is the entire point of the template.**
 * 10.6% of YD orders ship in more than one parcel (529 of 4,980 over 180 days, yd-features;
 * my own ShipStation count agrees once reships are excluded). One email per order
 * under-notifies one customer in ten: they get a single tracking number, wait for a parcel
 * nobody announced, and contact CS instead of the system telling anyone.
 *
 * **THE SENDER CHANGED IN FEBRUARY 2026, AND I GOT THIS WRONG TWICE IN ONE DAY. The current
 * sender is SFMC.** Establishing it took three passes, so the evidence is written down here
 * rather than left to be re-derived:
 *   - ShipStation (`tracking@shipstation.com`) sent them from at least **2025-09-29** to
 *     **2026-02-04**. **Zero after 2026-02-05** — searched, not assumed.
 *   - SFMC (`noreply@email.yogademocracy.com`) from **2026-02-26**, and verified live on
 *     **2026-06-22**: *"Good Things Are Headed Your Way"* / *"YOUR ORDER IS ON THE MOVE"*,
 *     with a tracking number, a Track Package button, and an item table.
 *
 * **The first wrong version said SFMC took over and was self-retracted; the second said SFMC
 * never sent it at all.** The second was worse, because it was produced by a Gmail search
 * filtered `from:(yogademocracy.com OR shipstation.com)` — and the live sender is the
 * **subdomain** `email.yogademocracy.com`, which that filter did not match. **The query
 * silently excluded exactly the population that would have contradicted it**, which is the
 * failure yd-promo named the day before. A filtered search must report what it filtered out.
 *
 * ── WHAT THE CURRENT (SFMC) EMAIL ACTUALLY CONTAINS, since that is the parity target ──────
 * Branded, warm, and competent: greeting by first name, tracking number, Track Package button,
 * *"Shipping To"* with the recipient's **name only — no address**, an Item/Qty table carrying
 * the **SKU**, and a full footer with YD's physical address.
 * **It also carries an unsubscribe and subscription-centre link on a transactional message.**
 * See the note in `shouldSend()`.
 *
 * **Two failures to avoid, and the second is now era-qualified rather than restated:**
 * - **The notice listed items that were not in the parcel.** On FO-0824 two ShipStation
 *   parcels to two different addresses each listed the identical full 10 items. A customer
 *   cannot tell what is in the box. **This template renders the SHIPMENT's own lines and
 *   nothing else.** The one SFMC sample says *"In your order:"* and holds a single item, so it
 *   **cannot distinguish per-parcel from per-order** — undetermined, and the per-parcel design
 *   stands on the 10.6% multi-parcel rate regardless.
 * - **Tracking announced for labels that were then voided.** See `shouldSend()`.
 */
import { shell, button, esc, INK, MUTED, RULE, PANEL, YD_PRIMARY } from "./layout.ts"
import { formatDay } from "./dates.ts"

export type ShipmentAddress = {
  name?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
}

export type ShipmentLine = {
  title: string
  options?: string[]
  quantity: number
}

export type ShipmentNoticeData = {
  display_id: string | number
  customer_name: string
  tracking_number: string
  /** Carrier's tracking page. Built by the caller so the carrier mapping lives in one place. */
  tracking_url: string
  /**
   * The carrier that actually carried it — **never the shipping method the customer bought.**
   *
   * These come apart in practice at YD: on 2026-03-31 the customer-service team reported *"this is not the first
   * customer who paid for FedEx shipping, and it ended up shipping via USPS."* Printing the
   * purchased method would tell that customer FedEx while USPS delivered — turning a
   * fulfilment problem into an email that lies about it.
   *
   * **Medusa cannot supply this.** `FulfillmentLabelDTO` is `{ id, tracking_number,
   * tracking_url, label_url, fulfillment_id }` — no carrier, no service. Whatever bought the
   * label knows; Medusa's own model does not. So this stays optional, is only ever set by a
   * caller that genuinely knows, and **`mapFulfillmentToShipmentNotice` deliberately does not
   * populate it.** An empty carrier line is a small loss; a confidently wrong one is not.
   */
  carrier?: string
  /** What is actually in THIS parcel. Never the order's lines. */
  items: ShipmentLine[]
  /**
   * Which parcel this is. `total` is often genuinely unknown at send time — more may yet ship —
   * so it is optional and **must not be guessed**. Saying "1 of 1" when a second parcel later
   * appears is worse than saying nothing.
   */
  parcel?: { index: number; total?: number }
  /**
   * Lines from the order NOT in this parcel and not yet shipped.
   *
   * **Three states, and they are different:** `[]` means nothing is outstanding and we can say
   * so; a non-empty array means we can tell the customer what is still coming; `undefined`
   * means **not determined** and the email says neither. Reading `undefined` as `[]` would
   * tell a customer their order is complete when it is not — the exact silent failure this
   * lane exists to prevent.
   */
  remaining_items?: ShipmentLine[]
  /**
   * Where it is going. **The incumbent shows this and we did not, and it is worth having.**
   * ShipStation's notice carries a full "Shipped To:" block, which is how a customer catches
   * a wrong or stale address while the parcel is still in the network rather than after it is
   * delivered somewhere else.
   *
   * `undefined` renders nothing — never a partial address, which would be worse than none.
   */
  shipped_to?: ShipmentAddress
  /** When it actually left, if known. Rendered as a day in Eastern time. */
  shipped_at?: string | Date
  status_url?: string
  /** Set when the shipping label has been voided. */
  voided?: boolean
}

/**
 * **WHAT THIS GUARD ACTUALLY DOES, AND WHAT IT DOES NOT. Corrected 2026-08-25 after measuring
 * it, because the previous version of this note claimed a property the wiring does not give.**
 *
 * The note used to say *"notify off the label being USED, not created."* **That is the right
 * principle and this system does not implement it.** `src/subscribers/shipment-created.ts`
 * fires on `shipment.created`, which is emitted when the label is CREATED, and `voided` is read
 * from `fulfillment.canceled_at` at that instant — when it is almost always null.
 *
 * **So this guard stops a fulfillment that was ALREADY cancelled before the event. It cannot
 * stop a label voided afterwards, which is the case that actually happens.**
 *
 * **Measured, not guessed — 25 voided labels since 2026-02-26, complete, nothing excluded.
 * Minutes from label creation to void:**
 *
 *      0 0 0 0 1 1 2 2 2 4 8 12 17 23 45 58 75 200 217 224 288 1163 10856 11565 12992
 *      median 17 min · p75 217 min · three of them a week later
 *
 * **Only the four zero-minute voids are inside what an immediate send can catch.** FO-2177's
 * was voided at 95 minutes; nothing here would have stopped that email.
 *
 * **A deferred send WOULD work, and here is the price, which is why the number is not mine to
 * pick:** holding 30 min catches 14/25, 60 min catches 16/25, 4 h catches 20/25, 24 h catches
 * 22/25 — **and the cost is that every customer's tracking email is delayed by that long, while
 * YD currently has an open complaint that tracking emails are not arriving.** Delaying all of
 * them to prevent roughly one wrong email every eleven days is **a business trade-off for Jeff
 * or the tech lead, with the numbers above**, not a default this file should choose quietly.
 *
 * **What is not optional is that the code stop claiming the protection it does not provide.**
 */
export function shouldSend(d: Pick<ShipmentNoticeData, "voided" | "tracking_number">): boolean {
  if (d.voided === true) return false
  return Boolean(d.tracking_number?.trim())
}

export function subject(d: Pick<ShipmentNoticeData, "display_id" | "parcel">): string {
  const p = d.parcel
  if (p && p.total && p.total > 1) {
    return `Parcel ${p.index} of ${p.total} from order #${d.display_id} is on its way`
  }
  if (p && p.index > 1) return `Another parcel from order #${d.display_id} is on its way`
  return `Your Yoga Democracy order #${d.display_id} has shipped`
}

export function preheader(d: Pick<ShipmentNoticeData, "display_id">): string {
  // Order number only: safe in list view, no contents and no money.
  return `Tracking for order #${d.display_id} is inside.`
}

function lines(items: ShipmentLine[]): string {
  return items.map((l) => `<tr><td style="padding:10px 16px;border-top:1px solid ${RULE};
      font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:${INK};">
      <div style="font-weight:600;">${esc(l.title)}</div>
      <div style="color:${MUTED};">${(l.options ?? []).map((o) => `${esc(o)}<br/>`).join("")}Qty: ${esc(l.quantity)}</div>
    </td></tr>`).join("")
}

/**
 * "Shipped to" — rendered only when there is a real address to show.
 *
 * **A partial address is worse than none**, because a customer scanning for the street they
 * moved from cannot tell a missing line from a wrong one. So this needs a street and a city
 * before it will render anything at all.
 */
function shippedToBlock(d: ShipmentNoticeData): string {
  const a = d.shipped_to
  const day = formatDay(d.shipped_at)
  if (!a?.address_1?.trim() || !a?.city?.trim()) {
    return day
      ? `<tr><td class="pad" style="padding:0 24px 18px;font-family:Inter,Helvetica,Arial,sans-serif;
           font-size:13px;line-height:20px;color:${MUTED};">Shipped ${esc(day)}.</td></tr>`
      : ""
  }
  const region = [a.city, a.province].filter((x) => x?.trim()).map((x) => esc(x!.trim())).join(", ")
  const rows = [a.name, a.address_1, a.address_2]
    .filter((x) => x?.trim()).map((x) => esc(x!.trim()))
    .concat([`${region}${a.postal_code?.trim() ? " " + esc(a.postal_code.trim()) : ""}`])
  return `<tr><td class="pad" style="padding:0 24px 18px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="border:1px solid ${RULE};">
      <tr><td style="background:${PANEL};padding:12px 18px;font-family:'Playfair Display',Georgia,serif;
        font-size:16px;color:${INK};">Shipped to${day ? ` &middot; ${esc(day)}` : ""}</td></tr>
      <tr><td style="padding:12px 18px;font-family:Inter,Helvetica,Arial,sans-serif;
        font-size:14px;line-height:21px;color:${MUTED};">${rows.join("<br/>")}</td></tr>
    </table></td></tr>`
}

export function renderShipmentNotice(d: ShipmentNoticeData): string | null {
  if (!shouldSend(d)) return null

  const p = d.parcel
  const parcelLine = p && p.total && p.total > 1
    ? `<div style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;
         letter-spacing:.06em;font-weight:700;font-size:13px;margin-top:6px;">
         Parcel ${esc(p.index)} of ${esc(p.total)} &middot; Order #${esc(d.display_id)}</div>`
    : `<div style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;
         letter-spacing:.06em;font-weight:700;font-size:13px;margin-top:6px;">
         Order #${esc(d.display_id)}</div>`

  // Three-state, deliberately. `undefined` says nothing at all.
  let rest = ""
  if (Array.isArray(d.remaining_items)) {
    rest = d.remaining_items.length === 0
      ? `<tr><td class="pad" style="padding:0 24px 22px;font-family:Inter,Helvetica,Arial,sans-serif;
           font-size:14px;line-height:21px;color:${MUTED};">That is everything from this order —
           nothing else is outstanding.</td></tr>`
      : `<tr><td class="pad" style="padding:0 24px 22px;">
          <div style="border:1px solid ${YD_PRIMARY};border-radius:8px;padding:12px 16px;
            font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:${INK};">
            <strong>Still to come.</strong> The rest of your order has not shipped yet — you will get
            a separate email with its own tracking when it does.
            <div style="margin-top:8px;color:${MUTED};">
              ${d.remaining_items.map((l) => `${esc(l.title)} &times; ${esc(l.quantity)}`).join("<br/>")}
            </div>
          </div></td></tr>`
  }

  const content = `
  <tr><td class="pad" style="padding:24px 24px 4px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:15px;line-height:23px;color:${INK};">
    <p style="margin:0 0 12px;">Hey ${esc(d.customer_name)},</p>
    <p style="margin:0;">It is packed and on the move.</p>
  </td></tr>

  <tr><td class="pad" style="padding:16px 24px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="background:${PANEL};border:1px solid ${RULE};">
      <tr><td align="center" style="padding:16px;font-family:Inter,Helvetica,Arial,sans-serif;">
        <div style="text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;
          color:${MUTED};">${esc(d.carrier ?? "Tracking number")}</div>
        <div style="font-family:'Courier New',Courier,monospace;font-size:16px;font-weight:700;
          color:${INK};margin-top:6px;word-break:normal;overflow-wrap:break-word;">${esc(d.tracking_number)}</div>
      </td></tr>
    </table></td></tr>

  <tr><td align="center" style="padding:16px 24px 20px;">${button(d.tracking_url, "Track this parcel")}</td></tr>

  ${shippedToBlock(d)}

  <tr><td class="pad" style="padding:0 24px 18px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="border:1px solid ${RULE};">
      <tr><td style="background:${PANEL};padding:12px 18px;font-family:'Playfair Display',Georgia,serif;
        font-size:16px;color:${INK};">In this parcel</td></tr>
      ${lines(d.items)}
    </table></td></tr>

  ${rest}`

  return shell({
    title: subject(d),
    preheader: preheader(d),
    headline: p && p.total && p.total > 1 ? "Part of your order is here." : "It's on the way.",
    kicker: parcelLine.replace(/^<div[^>]*>|<\/div>$/g, ""),
    content,
  })
}
