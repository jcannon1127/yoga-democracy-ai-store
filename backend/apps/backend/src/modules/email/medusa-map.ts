/**
 * Medusa's order and fulfillment records -> the data the templates take.
 *
 * **This file exists because of a 100x money error I found in my own code by reading
 * Medusa's source instead of trusting my own comment.**
 *
 * `ConfirmationLine.unit_price` is documented in `templates/order-confirmation.ts` as
 * "minor units (cents), **matching Medusa's money fields**". The second half of that was
 * false. Medusa 2 abandoned integer cents: every amount is a `BigNumberValue` in **decimal
 * currency units** — `57` means fifty-seven dollars, not fifty-seven cents. Handing
 * `order.total` straight to a template that divides by 100 renders a $57.00 order as $0.57,
 * and a naive "it must be cents already" mapper renders it as $5,700.00.
 *
 * **Nothing would have caught it.** Every template test passes cents and gets cents back;
 * every Medusa integration test checks the order, not the email. The error only exists in
 * the join between them, which is this file, and it only shows up on a real customer's
 * receipt. So the conversion lives in exactly one function, and that function refuses rather
 * than guesses.
 *
 * ── THE REFUSALS, AND WHY EACH IS A REFUSAL RATHER THAN A DEFAULT ─────────────────────────
 * A missing amount must never become `0`. "$0.00" on a receipt is not a formatting glitch;
 * it tells a customer their order was free, and it is indistinguishable from a genuine
 * comped order. Same for a missing currency: the same number renders as $57 or £57, and
 * defaulting to USD would be silently right for YD until the day it was not.
 */
import type { ConfirmationOrder, ConfirmationLine, Address } from "./templates/order-confirmation.ts"
import type { ShipmentNoticeData, ShipmentLine, ShipmentAddress } from "./templates/shipment-notice.ts"

export type MapResult<T> =
  | { ok: true; value: T; notes: string[] }
  | { ok: false; reason: string }

/** When we have no name at all. Explicit and noted, never a silent empty greeting. */
const GREETING_FALLBACK = "there"

/**
 * A Medusa `BigNumberValue` -> integer minor units.
 *
 * Accepts the four shapes that actually reach a subscriber: a plain number, a decimal string,
 * a serialised raw value `{ value: "57.00" }`, and a live `BigNumber` instance (whose
 * `valueOf` returns the numeric value).
 *
 * **Returns null for anything else — including `null`, `undefined`, `NaN` and `""`.** Callers
 * must treat null as "cannot render this email", not as zero.
 *
 * `Math.round` is deliberate and not cosmetic: `19.99 * 100` is `1998.9999999999998` in IEEE
 * doubles, so truncating would charge the customer's eye a penny less on roughly every price
 * YD sells. Rounding is exact for every value inside double precision at these magnitudes.
 */
export function toMinorUnits(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) ? Math.round(v * 100) : null
  }
  if (typeof v === "string") {
    const t = v.trim()
    // Full-match, so "57abc" and "" are refused rather than parsed to 57 or NaN.
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null
    return Math.round(Number(t) * 100)
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    if (typeof o.numeric === "number" && Number.isFinite(o.numeric)) {
      return Math.round(o.numeric * 100)
    }
    if ("value" in o) return toMinorUnits(o.value)

    // **The permissive fallback is where a wrong number gets in, so it is a POSITIVE test.**
    // `Number(v)` on its own accepts far too much: `Number([])` is 0 — an empty array, the
    // shape a stripped or half-serialised payload arrives in, becomes a confident $0.00 —
    // and `Number(new Date())` is epoch milliseconds, so a date landing in a money field
    // renders about $17,500,000,000 without anything erroring.
    //
    // A real `BigNumber` is none of those things: it is a plain object whose `valueOf`
    // returns a finite number. That is the whole requirement, and each clause below has a
    // concrete input that fails it rather than being defensive decoration:
    //   []            -> valueOf() returns the array    (would have been 0)
    //   {}            -> valueOf() returns the object   (would have been NaN)
    //   new Date()    -> instanceof Date                (would have been epoch ms)
    //
    // The Date clause is the only one that needs stating separately, and it is the reason
    // this is not simply `Number.isFinite(Number(v))`: a Date's `valueOf` DOES return a
    // finite number. An explicit `Array.isArray` guard stood here until the mutation harness
    // showed it was dead — arrays fail the valueOf test on their own — and a dead guard in a
    // money path reads as protection that is not there.
    if (v instanceof Date) return null
    const primitive = typeof o.valueOf === "function" ? o.valueOf() : undefined
    if (typeof primitive !== "number" || !Number.isFinite(primitive)) return null
    return Math.round(primitive * 100)
  }
  return null
}

/** Optional money: absent stays absent, present-but-unreadable is an error the caller sees. */
function optionalMinor(v: unknown): { ok: true; value?: number } | { ok: false } {
  if (v === undefined || v === null) return { ok: true }
  const m = toMinorUnits(v)
  return m === null ? { ok: false } : { ok: true, value: m }
}

type MedusaAddress = Partial<Address> & Record<string, unknown>

function mapAddress(a: unknown): Address | undefined {
  if (!a || typeof a !== "object") return undefined
  const s = a as MedusaAddress
  const out: Address = {}
  for (const k of ["first_name", "last_name", "address_1", "address_2", "city", "province",
    "postal_code"] as const) {
    const v = s[k]
    if (typeof v === "string" && v.trim()) out[k] = v.trim()
  }
  return Object.keys(out).length ? out : undefined
}

function nameFrom(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue
    const o = c as Record<string, unknown>
    const parts = [o.first_name, o.last_name].filter((p) => typeof p === "string" && p.trim())
    if (parts.length) return parts.join(" ").trim()
  }
  return undefined
}

/**
 * Medusa line items -> template lines.
 *
 * **`backordered` is left `undefined` on every line, on purpose.** Medusa's order line has no
 * such field, and the template's own contract says `undefined` means "not determined" and
 * renders no note, while `false` asserts the item is in stock. Filling in `false` because it
 * is the convenient default would print a confident "ships now" on genuinely backordered
 * items — the precise failure this lane was built to prevent, and it would be introduced by
 * the mapper rather than by the template. Whoever computes real availability at order time
 * sets it; until then the email says nothing rather than something false.
 */
function mapLines(items: unknown): { ok: true; lines: ConfirmationLine[] } | { ok: false; reason: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: "order has no line items — nothing to confirm" }
  }
  const lines: ConfirmationLine[] = []
  for (const [i, raw] of items.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>
    const title = typeof it.title === "string" && it.title.trim() ? it.title.trim() : null
    if (!title) return { ok: false, reason: `line ${i} has no title` }

    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, reason: `line ${i} (${title}) has no usable quantity` }
    }

    const unit = toMinorUnits(it.unit_price)
    if (unit === null) {
      // Not a default. A line with an unreadable price cannot appear on a receipt at all.
      return { ok: false, reason: `line ${i} (${title}) has no readable unit_price` }
    }

    const options: string[] = []
    // `variant_title` is Medusa's rendered option summary ("L / Standard"); `subtitle` is the
    // product name when the line title is the variant. Only genuinely present strings.
    for (const k of ["variant_title", "subtitle"] as const) {
      const v = it[k]
      if (typeof v === "string" && v.trim() && v.trim() !== title) options.push(v.trim())
    }

    lines.push({
      title,
      quantity: qty,
      unit_price: unit,
      ...(options.length ? { options } : {}),
      ...(typeof it.thumbnail === "string" ? { thumbnail: it.thumbnail } : {}),
      // backordered: deliberately absent — see the note above.
    })
  }
  return { ok: true, lines }
}

/**
 * Fulfillment items -> `ShipmentLine`.
 *
 * **Separate from `mapLines` because a fulfillment item has no price, and reusing the order
 * mapper here would have refused every shipment notice ever sent.** Medusa's
 * `FulfillmentItemDTO` is `{ id, title, quantity, sku, barcode, line_item_id, ... }` — there
 * is no `unit_price` on it, and there is none on `ShipmentLine` either, because a parcel
 * slip is not a receipt. `mapLines` refuses a line with no readable price, which is right for
 * a receipt and catastrophic here: every single shipment would have failed to map, and the
 * failure would have read as a clean, well-reasoned refusal.
 */
function mapShipmentLines(items: unknown): { ok: true; lines: ShipmentLine[] } | { ok: false; reason: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: "fulfillment has no items — nothing to say is in the parcel" }
  }
  const lines: ShipmentLine[] = []
  for (const [i, raw] of items.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>
    const title = typeof it.title === "string" && it.title.trim() ? it.title.trim() : null
    if (!title) return { ok: false, reason: `fulfillment item ${i} has no title` }
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, reason: `fulfillment item ${i} (${title}) has no usable quantity` }
    }
    lines.push({ title, quantity: qty })
  }
  return { ok: true, lines }
}

export type MedusaOrderLike = Record<string, unknown>

/**
 * A Medusa order -> `ConfirmationOrder`.
 *
 * Refuses on: no currency, no readable total, no line items, an unreadable line price, or an
 * unreadable optional total that is present. Everything it refuses on is something that would
 * otherwise print a wrong number on a document about the customer's money.
 */
export function mapOrderToConfirmation(
  order: MedusaOrderLike | null | undefined,
  opts: { statusUrl?: string } = {}
): MapResult<ConfirmationOrder> {
  if (!order || typeof order !== "object") {
    return { ok: false, reason: "no order supplied" }
  }
  const notes: string[] = []

  const currency = typeof order.currency_code === "string" ? order.currency_code.trim() : ""
  if (!currency) {
    return { ok: false, reason: "order has no currency_code — the same number reads as $57 or £57" }
  }

  const lines = mapLines(order.items)
  if (!lines.ok) return { ok: false, reason: lines.reason }

  const total = toMinorUnits(order.total)
  if (total === null) {
    return { ok: false, reason: "order has no readable total — $0.00 on a receipt is a lie" }
  }

  // `item_subtotal` is Medusa's pre-shipping, pre-tax figure; `subtotal` on some payloads
  // already includes shipping. Prefer the explicit one, fall back, and never invent.
  const subtotalSrc = order.item_subtotal ?? order.subtotal
  const subtotal = toMinorUnits(subtotalSrc)
  if (subtotal === null) {
    return { ok: false, reason: "order has no readable subtotal" }
  }

  const shipping = optionalMinor(order.shipping_total)
  const tax = optionalMinor(order.tax_total)
  const discount = optionalMinor(order.discount_total)
  for (const [label, r] of [["shipping_total", shipping], ["tax_total", tax],
    ["discount_total", discount]] as const) {
    if (!r.ok) return { ok: false, reason: `order has an unreadable ${label}` }
  }

  const shippingAddress = mapAddress(order.shipping_address)
  if (!shippingAddress) {
    return { ok: false, reason: "order has no shipping address to confirm" }
  }

  const displayId = order.display_id
  if (displayId === undefined || displayId === null || displayId === "") {
    return { ok: false, reason: "order has no display_id — the customer has no number to quote" }
  }

  const createdAt = order.created_at
  if (!(typeof createdAt === "string" || createdAt instanceof Date)) {
    return { ok: false, reason: "order has no usable created_at" }
  }

  let customerName = nameFrom(order.shipping_address, order.customer, order.billing_address)
  if (!customerName) {
    // Benign, but not invisible: a fallback greeting is normal, silently losing a name is not.
    notes.push("no customer name on the order — greeting falls back to \"there\"")
    customerName = GREETING_FALLBACK
  }

  return {
    ok: true,
    notes,
    value: {
      display_id: displayId as string | number,
      created_at: createdAt,
      customer_name: customerName,
      currency_code: currency,
      items: lines.lines,
      subtotal,
      shipping_total: shipping.ok && shipping.value !== undefined ? shipping.value : 0,
      tax_total: tax.ok && tax.value !== undefined ? tax.value : 0,
      ...(discount.ok && discount.value ? { discount_total: discount.value } : {}),
      total,
      shipping_address: shippingAddress,
      ...(mapAddress(order.billing_address) ? { billing_address: mapAddress(order.billing_address) } : {}),
      ...(opts.statusUrl ? { status_url: opts.statusUrl } : {}),
    },
  }
}

export type MedusaFulfillmentLike = Record<string, unknown>

/**
 * A Medusa fulfillment (as named by `shipment.created`) + its order -> `ShipmentNoticeData`.
 *
 * **`remaining_items` is only computed when the caller supplies every fulfillment on the
 * order, and is left `undefined` otherwise.** The template documents three distinct states
 * and this is the one that is easy to destroy: `[]` tells the customer nothing else is
 * coming. Computing "what is left" from one fulfillment would produce `[]` for the first
 * parcel of a split order and tell a waiting customer they had everything.
 */
export function mapFulfillmentToShipmentNotice(
  fulfillment: MedusaFulfillmentLike | null | undefined,
  order: MedusaOrderLike | null | undefined,
  opts: { statusUrl?: string; allFulfillments?: MedusaFulfillmentLike[] } = {}
): MapResult<ShipmentNoticeData> {
  if (!fulfillment || typeof fulfillment !== "object") {
    return { ok: false, reason: "no fulfillment supplied" }
  }
  if (!order || typeof order !== "object") {
    return { ok: false, reason: "no order supplied — shipment.created carries no order id" }
  }
  const notes: string[] = []

  const displayId = order.display_id
  if (displayId === undefined || displayId === null || displayId === "") {
    return { ok: false, reason: "order has no display_id" }
  }

  const labels = Array.isArray(fulfillment.labels) ? fulfillment.labels : []
  const primary = (labels[0] ?? {}) as Record<string, unknown>
  const trackingNumber = typeof primary.tracking_number === "string"
    ? primary.tracking_number.trim() : ""
  const trackingUrl = typeof primary.tracking_url === "string" ? primary.tracking_url.trim() : ""

  // **A fulfillment boxed into several parcels carries several labels.** The template holds
  // one tracking number, so the rest would vanish. Sending the first beats sending nothing,
  // but the extras are named here so a human sees them rather than a customer missing them.
  if (labels.length > 1) {
    const extras = labels.slice(1)
      .map((l) => (l as Record<string, unknown>)?.tracking_number)
      .filter((t) => typeof t === "string" && t.trim())
    notes.push(
      `fulfillment has ${labels.length} labels; the email carries only the first. ` +
        `NOT SENT TO THE CUSTOMER: ${extras.join(", ") || "(unnamed)"}`
    )
  }

  const lines = mapShipmentLines(fulfillment.items)
  if (!lines.ok) {
    return { ok: false, reason: `shipment contents unreadable: ${lines.reason}` }
  }

  let remaining: ShipmentNoticeData["remaining_items"]
  if (Array.isArray(opts.allFulfillments)) {
    remaining = computeRemaining(order, opts.allFulfillments)
    if (remaining === undefined) {
      notes.push(
        "could not join fulfillment items to order lines on line_item_id — " +
          "remaining_items left undetermined rather than guessed"
      )
    }
  }

  const addr = mapAddress(order.shipping_address)
  const shippedTo: ShipmentAddress | undefined = addr
    ? {
        ...(nameFrom(order.shipping_address) ? { name: nameFrom(order.shipping_address) } : {}),
        ...(addr.address_1 ? { address_1: addr.address_1 } : {}),
        ...(addr.address_2 ? { address_2: addr.address_2 } : {}),
        ...(addr.city ? { city: addr.city } : {}),
        ...(addr.province ? { province: addr.province } : {}),
        ...(addr.postal_code ? { postal_code: addr.postal_code } : {}),
      }
    : undefined

  const customerName =
    nameFrom(order.shipping_address, order.customer, order.billing_address) ?? GREETING_FALLBACK
  if (customerName === GREETING_FALLBACK) {
    notes.push("no customer name on the order — greeting falls back to \"there\"")
  }

  return {
    ok: true,
    notes,
    value: {
      display_id: displayId as string | number,
      customer_name: customerName,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      items: lines.lines,
      ...(remaining !== undefined ? { remaining_items: remaining } : {}),
      // Where it went, and when it left. Both absent-if-unknown; the template renders neither
      // rather than a partial address or a made-up date.
      ...(shippedTo ? { shipped_to: shippedTo } : {}),
      ...(typeof fulfillment.shipped_at === "string" || fulfillment.shipped_at instanceof Date
        ? { shipped_at: fulfillment.shipped_at as string | Date } : {}),
      // carrier / service: DELIBERATELY NOT SET. Medusa's label carries neither, and the only
      // thing to hand — the shipping method the customer BOUGHT — is exactly what must not be
      // printed. See the note on `carrier` in the template.
      ...(opts.statusUrl ? { status_url: opts.statusUrl } : {}),
      // A cancelled fulfillment is a voided label; the template refuses to send on it.
      ...(fulfillment.canceled_at ? { voided: true } : {}),
    },
  }
}

/**
 * What of the order has NOT shipped yet, or `undefined` when that cannot be established.
 *
 * **The join is on `line_item_id`, and if any shipped item cannot be joined this returns
 * `undefined` rather than a partial answer.** Fulfillment items carry the variant's title,
 * which is not always the order line's title, so matching on text would silently fail to
 * subtract a shipped item and report it as still outstanding — or, worse, match the wrong
 * line on an order containing the same style in two sizes.
 *
 * **A wrong "still to come" list and a wrong empty list fail in opposite directions and both
 * are worse than silence.** An empty list tells a waiting customer their order is complete;
 * a phantom entry tells a complete customer something is missing and generates the support
 * ticket the email was meant to prevent. The template already treats `undefined` as "say
 * nothing", so refusing the join costs one paragraph and risks nothing.
 *
 * Cancelled fulfillments are excluded — a voided label did not ship anything.
 */
function computeRemaining(
  order: MedusaOrderLike,
  allFulfillments: MedusaFulfillmentLike[]
): ShipmentLine[] | undefined {
  const orderLines = Array.isArray(order.items) ? order.items : null
  if (!orderLines?.length) return undefined

  const ordered = new Map<string, { title: string; quantity: number }>()
  for (const raw of orderLines) {
    const l = (raw ?? {}) as Record<string, unknown>
    const id = typeof l.id === "string" ? l.id : null
    const title = typeof l.title === "string" ? l.title.trim() : ""
    const qty = Number(l.quantity)
    // No id on an order line means nothing can be joined to it. Refuse the whole answer.
    if (!id || !title || !Number.isFinite(qty)) return undefined
    ordered.set(id, { title, quantity: qty })
  }

  for (const f of allFulfillments) {
    if (!f || typeof f !== "object") return undefined
    if ((f as Record<string, unknown>).canceled_at) continue
    const its = (f as Record<string, unknown>).items
    if (!Array.isArray(its)) return undefined
    for (const raw of its) {
      const it = (raw ?? {}) as Record<string, unknown>
      const lineId = typeof it.line_item_id === "string" ? it.line_item_id : null
      const qty = Number(it.quantity)
      // An unjoinable shipped item would be counted as never shipped. Refuse instead.
      if (!lineId || !ordered.has(lineId) || !Number.isFinite(qty)) return undefined
      const entry = ordered.get(lineId)!
      entry.quantity -= qty
    }
  }

  return [...ordered.values()]
    .filter((l) => l.quantity > 0)
    .map((l) => ({ title: l.title, quantity: l.quantity }))
}
