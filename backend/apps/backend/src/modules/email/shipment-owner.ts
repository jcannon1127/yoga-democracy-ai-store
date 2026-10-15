/**
 * WHO SENDS THE SHIPMENT EMAIL — and why this has to be declared rather than defaulted.
 *
 * **CORRECTED 2026-08-25. An earlier version of this file said ShipStation sends YD's shipment
 * notices today and that SFMC never had. Both halves were wrong.** The sender changed in
 * February 2026:
 *   - ShipStation (`tracking@shipstation.com`) — at least 2025-09-29 to **2026-02-04**, then
 *     **zero**, searched rather than assumed.
 *   - SFMC (`noreply@email.yogademocracy.com`) — from **2026-02-26**, verified live on
 *     **2026-06-22**: branded, with tracking, a Track Package button and an item table.
 *
 * **The wrong version came from a Gmail search filtered `from:(yogademocracy.com OR
 * shipstation.com)`, and the live sender is the SUBDOMAIN `email.yogademocracy.com`** — which
 * that filter did not match. The query silently dropped the only population that could have
 * contradicted it.
 *
 * ── THE DEFECT THIS GUARDS IS UNCHANGED, AND THE CORRECTION MAKES IT WORSE, NOT BETTER ────
 *
 * Whoever emails the customer does so off ShipStation's fulfilment data. Medusa orders have to
 * reach ShipStation for anything to ship, so that pipeline keeps running after cutover.
 * **The moment a real transport is wired here, a customer can receive our notice AND the
 * existing one** — and nothing errors, because both systems are working exactly as configured.
 * Each side looks healthy in its own logs.
 *
 * **And with SFMC as the incumbent the collision is harder to switch off, not easier**: the
 * send lives in a Marketing Cloud journey nobody in this repo can see, rather than in a
 * ShipStation store toggle. Whether SFMC survives leaving SFCC is a real question again — but
 * it is a question about *this* collision, not about whether the notice has a sender at all.
 *
 * So it must be chosen, not defaulted. `SHIPMENT_NOTICE_OWNER` is `medusa` or `shipstation`
 * (read as "the existing sender, whichever it is"), and anything else refuses.
 *
 * ── AND THE CHOICE IS NOT OBVIOUS, WHICH IS WHY IT IS NOT MINE ────────────────────────────
 *
 * There is real evidence on both sides and it belongs to Jeff and the tech lead:
 *   - **For the incumbent:** it fires from the party that actually buys the label, so it cannot
 *     claim a shipment that did not happen — more than our subscriber can promise until it has
 *     run once against a real fulfilment. And the current SFMC email is genuinely good: warm,
 *     branded, correct.
 *   - **Against it:** the send is invisible from here, it fires 30 minutes after label creation
 *     (so a later void is still announced), and it carries an **unsubscribe link on a
 *     transactional message**.
 *
 * ── ONE CONSEQUENCE TO CARRY, STATED HERE BECAUSE IT IS EASY TO MISS ──────────────────────
 *
 * **If the owner is `shipstation`, reconciling `shipment-notice` per order is meaningless and
 * will report EVERY order as un-emailed.** `deliveredSends` counts only `send`, and in that
 * mode there are none — by design. A permanent red that is correct-by-configuration is worse
 * than no check at all, because it trains whoever reads it to ignore the one that matters. Do
 * not run that reconciliation in that mode; run the ShipStation side instead.
 */
export type ShipmentOwner =
  | { state: "ours"; detail: string }
  | { state: "shipstation"; detail: string }
  | { state: "undeclared"; detail: string }

export function shipmentOwner(env: Record<string, string | undefined>): ShipmentOwner {
  const raw = env.SHIPMENT_NOTICE_OWNER?.trim().toLowerCase()

  if (raw === "medusa") {
    return { state: "ours",
      detail: "SHIPMENT_NOTICE_OWNER=medusa — we send it. ShipStation's own notification must " +
        "be turned OFF for this store, or every customer gets two emails per parcel." }
  }
  if (raw === "shipstation") {
    return { state: "shipstation",
      detail: "SHIPMENT_NOTICE_OWNER=shipstation — ShipStation owns the shipment email and we " +
        "send nothing. NOTE: reconciling shipment-notice per order is meaningless in this " +
        "mode and will report every order as un-emailed." }
  }
  return { state: "undeclared",
    detail: raw
      ? `SHIPMENT_NOTICE_OWNER=${JSON.stringify(raw)} is not "medusa" or "shipstation" — ` +
        `refusing to send rather than guess which system owns the customer's tracking email`
      : `SHIPMENT_NOTICE_OWNER is unset. ShipStation is sending YD's shipment notices TODAY ` +
        `(verified: tracking@shipstation.com, "Your order has been shipped!"). Sending ours ` +
        `as well would give every customer TWO emails per parcel, with nothing erroring on ` +
        `either side. Set it to "medusa" (and turn ShipStation's off) or to "shipstation".` }
}
