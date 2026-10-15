/**
 * Order confirmation email.
 *
 * **This is a rebuild, not a port.** Today's confirmation is sent by SFCC itself —
 * `dw.net.Mail` rendering an ISML template, verified from raw headers (JavaMail on
 * blade*.mon.demandware.net via outgoing.POD287.demandware.net). No ESP is in the path,
 * so there is no template anywhere to re-point; it dies with SFCC.
 *
 * Four things the SFCC email does NOT contain, read off a real rendered send rather than
 * assumed, all of which are net-new here: **no backorder note, no order date, no
 * order-status or tracking link, and no correct subject line.**
 *
 * **The subject line is the cautionary tale.** Live confirmations have carried
 * `Subject: Yoga Democracy <cs@yogademocracy.com>` since some time between 2025-10-28 and
 * 2026-02-26 — the From string written into the Subject field. Nothing errors, nobody sees
 * it internally, and a subject line that is an email address is a spam signal on the one
 * message every customer must receive. `subject()` below is a function with a test, not a
 * config string someone can quietly break.
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { shell, button, esc, YD_PRIMARY, INK, MUTED, RULE, PANEL } from "./layout.ts"

export type ConfirmationLine = {
  title: string
  /** "Size: L", "Length: Standard (28\")" etc. Already human-facing. */
  options?: string[]
  thumbnail?: string | null
  quantity: number
  /** Minor units (cents), matching Medusa's money fields. */
  unit_price: number
  /**
   * Whether THIS LINE is actually on backorder — not whether its SKU could be.
   *
   * **These are different things and conflating them is the trap.** yd-alloc's
   * `sellability` (`in_stock` / `backorderable` / `while_stock_lasts`) describes what the
   * SKU is *allowed* to do. A line whose SKU is `backorderable` but which had stock on
   * hand at purchase ships immediately — putting "ships in 10-14 days" on it is a false
   * delay on an item already in a box.
   *
   * So this flag must be computed at order time from ACTUAL availability, never derived
   * from `sellability` alone.
   *
   * **`undefined` means "not determined" and renders no note at all.** It must never be
   * read as `false` — a silently-omitted note on a genuinely backordered line is the
   * failure this whole lane exists to prevent, and it should surface as
   * "could not determine" in the detector rather than as a clean-looking email.
   */
  backordered?: boolean
}

export type ConfirmationOrder = {
  display_id: string | number
  created_at: Date | string
  customer_name: string
  currency_code: string
  items: ConfirmationLine[]
  subtotal: number
  discount_total?: number
  shipping_total: number
  tax_total: number
  total: number
  shipping_address: Address
  billing_address?: Address
  payment?: { brand?: string; last4?: string }
  /** Where the customer checks progress. Absent on the SFCC email entirely. */
  status_url?: string
}

export type Address = {
  first_name?: string
  last_name?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
    .format(minor / 100)
}

function orderDate(d: Date | string): string {
  // Eastern time, always — never UTC. A confirmation stamped a day off is a support ticket.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric",
  }).format(typeof d === "string" ? new Date(d) : d)
}

/**
 * The backorder promise, read from content — the same file and key the product page reads,
 * so the page and the email cannot drift apart.
 *
 * **Read from disk at send time, deliberately not `import`ed.** A bundler inlines an
 * imported JSON at build time, which would mean changing the promise requires a redeploy —
 * and the whole reason the number lives in content is that Jeff must be able to correct it
 * in seconds when it stops being true.
 *
 * **Returns null rather than a fallback when the key is missing.** A hardcoded "10-14 days"
 * here would survive somebody deliberately changing or removing the promise, which is worse
 * than showing nothing: it would keep making a commitment YD had decided to stop making.
 */
export type BackorderCopy =
  /** Content read, key present. Use it. */
  | { state: "ok"; message: string }
  /** Content read, key deliberately absent. Render nothing. This is a valid state. */
  | { state: "absent" }
  /** Content could NOT be read. NOT the same as absent — this is a wiring fault. */
  | { state: "unreadable"; reason: string }

/** Walk up from `from` looking for the storefront's content file. Layout-independent, so a
 *  compiled `dist/` at a different depth cannot silently break the lookup. */
function findSiteChrome(from: string): string | null {
  let dir = from
  for (let i = 0; i < 12; i++) {
    const candidate = resolve(dir, "storefront/src/content/site-chrome.json")
    if (existsSync(candidate)) return candidate
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

export function backorderCopy(): BackorderCopy {
  const override = process.env.YD_SITE_CHROME_PATH
  const path = override ?? findSiteChrome(__dirnameCompat()) ?? findSiteChrome(process.cwd())
  if (!path) return { state: "unreadable", reason: "site-chrome.json not found from module or cwd" }
  let parsed: { backorder?: { message?: string } }
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    return { state: "unreadable", reason: `${path}: ${(e as Error).message}` }
  }
  const m = parsed?.backorder?.message
  if (typeof m === "string" && m.trim()) return { state: "ok", message: m }
  return { state: "absent" }
}

/** Works under both ESM and the CJS output Medusa builds to. */
function __dirnameCompat(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyMeta = (typeof __dirname !== "undefined" ? __dirname : null) as string | null
  if (anyMeta) return anyMeta
  try {
    return dirname(fileURLToPath(eval("import.meta.url")))
  } catch {
    return process.cwd()
  }
}

/** Convenience for callers that only want the string. `null` covers absent AND unreadable —
 *  use `backorderCopy()` directly when you need to tell those apart, which the detector must. */
export function backorderMessage(): string | null {
  const c = backorderCopy()
  return c.state === "ok" ? c.message : null
}

/** Subject line. A function with a test, because this is the field that broke on SFCC. */
export function subject(order: Pick<ConfirmationOrder, "display_id">): string {
  return `Your Yoga Democracy order #${order.display_id}`
}

function addressBlock(a?: Address): string {
  if (!a) return ""
  const line2 = a.address_2 ? `<div>${esc(a.address_2)}</div>` : ""
  return `<div>${esc(a.first_name)} ${esc(a.last_name)}</div>
    <div>${esc(a.address_1)}</div>${line2}
    <div>${esc(a.city)}, ${esc(a.province)} ${esc(a.postal_code)}</div>`
}

function lineRow(l: ConfirmationLine, currency: string, backMsg: string | null): string {
  const opts = (l.options ?? []).map((o) => `${esc(o)}<br/>`).join("")

  /** No thumbnail must COLLAPSE the column, not leave a 96px hole. Medusa line items can
   *  lack one, and an empty cell cost a quarter of the row width at phone size — found by
   *  rendering it and looking, not by reading the markup. */
  const imgCell = l.thumbnail
    ? `<td width="96" style="width:96px;vertical-align:top;padding-right:16px;">
         <img src="${esc(l.thumbnail)}" width="96" alt="${esc(l.title)}"
           style="display:block;border-radius:4px;width:96px;max-width:96px;height:auto;"></td>`
    : ""

  /** **Qty and price must not be ambiguous on a money document.** "Qty: 2" above "$90.00"
   *  reads as ninety dollars for the pair. Show the arithmetic. */
  const price = l.quantity > 1
    ? `${esc(l.quantity)} &times; ${esc(money(l.unit_price, currency))}
       <span style="color:${INK};font-weight:600;">&nbsp;=&nbsp;${esc(money(l.unit_price * l.quantity, currency))}</span>`
    : `<span style="color:${INK};font-weight:600;">${esc(money(l.unit_price, currency))}</span>`

  // Only where the line is ACTUALLY backordered, and only if content still carries the promise.
  const note = l.backordered === true && backMsg
    ? `<div style="margin-top:6px;font-size:13px;line-height:18px;color:${YD_PRIMARY};font-weight:600;">
         ${esc(backMsg)}</div>`
    : ""

  return `<tr><td style="padding:12px 16px;border-top:1px solid ${RULE};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      ${imgCell}
      <td style="font-family:Inter,Helvetica,Arial,sans-serif;color:${INK};font-size:14px;line-height:20px;">
        <div style="margin:0 0 6px;font-weight:600;">${esc(l.title)}</div>
        <div style="color:${MUTED};">${opts}${price}</div>
        ${note}
      </td>
    </tr></table></td></tr>`
}

function summaryRow(label: string, value: string, strong = false): string {
  const w = strong ? "600" : "400"
  return `<tr><td style="padding:4px 0;color:${MUTED};font-weight:${w};">${esc(label)}</td>
    <td align="right" style="padding:4px 0;color:${INK};font-weight:${w};">${esc(value)}</td></tr>`
}

export function renderOrderConfirmation(order: ConfirmationOrder): string {
  const c = order.currency_code
  const backMsg = backorderMessage()
  const anyBackordered = order.items.some((l) => l.backordered === true)
  const rows = order.items.map((l) => lineRow(l, c, backMsg)).join("")

  const banner = anyBackordered && backMsg
    ? `<tr><td class="pad" style="padding:18px 24px 0;">
        <div style="border:1px solid ${YD_PRIMARY};border-radius:8px;padding:12px 16px;
             font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:${INK};">
          Some items are made to order. Those lines are marked below — ${esc(backMsg.replace(/^On backorder\s*[—-]\s*/i, ""))}.
          The rest ships as soon as it is packed.
        </div></td></tr>`
    : ""

  const statusBtn = order.status_url
    ? `<tr><td align="center" style="padding:18px 24px 8px;">${button(order.status_url, "Track your order")}</td></tr>`
    : ""

  const content = `
  <tr><td class="pad" style="padding:24px 24px 8px;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:15px;line-height:23px;color:${INK};">
    <p style="margin:0 0 12px;">Hey ${esc(order.customer_name)},</p>
    <p style="margin:0;">We have your order. You will hear from us again the moment it ships —
      and if it ships in more than one parcel, you will hear from us for each one.</p>
  </td></tr>
  ${banner}
  ${statusBtn}

  <tr><td class="pad" style="padding:16px 24px 24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="border:1px solid ${RULE};">
      <tr><td style="background:${PANEL};padding:12px 18px;font-family:'Playfair Display',Georgia,serif;
        font-size:16px;color:${INK};">In your order</td></tr>
      ${rows}
    </table></td></tr>

  <tr><td class="pad" style="padding:0 24px 8px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td width="50%" class="stack" style="vertical-align:top;padding:0 12px 16px 0;
        font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:${MUTED};">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:17px;color:${INK};margin-bottom:6px;">Shipping</div>
        <div style="height:1px;background:#e5e7eb;margin-bottom:8px;"></div>
        ${addressBlock(order.shipping_address)}
      </td>
      <td width="50%" class="stack" style="vertical-align:top;padding:0 0 16px 12px;
        font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:${MUTED};">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:17px;color:${INK};margin-bottom:6px;">Billing</div>
        <div style="height:1px;background:#e5e7eb;margin-bottom:8px;"></div>
        ${addressBlock(order.billing_address ?? order.shipping_address)}
        ${order.payment?.last4
          ? `<div style="margin-top:8px;">${esc(order.payment.brand ?? "Card")} ending ${esc(order.payment.last4)}</div>`
          : ""}
      </td>
    </tr></table></td></tr>

  <tr><td class="pad" style="padding:8px 24px 26px;">
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:17px;color:${INK};margin-bottom:6px;">Order summary</div>
    <div style="height:1px;background:#e5e7eb;margin-bottom:8px;"></div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;">
      ${summaryRow("Subtotal", money(order.subtotal, c))}
      ${order.discount_total ? summaryRow("Discount", `- ${money(order.discount_total, c)}`) : ""}
      ${summaryRow("Shipping", money(order.shipping_total, c))}
      ${summaryRow("Sales tax", money(order.tax_total, c))}
      ${summaryRow("Total", money(order.total, c), true)}
    </table></td></tr>`

  return shell({
    title: subject(order),
    // Safe in list view: an order number, not contents or money.
    preheader: `Order #${order.display_id} received. We will email you again when it ships.`,
    headline: "Thank you.",
    kicker: `Order #${esc(order.display_id)} &middot; ${esc(orderDate(order.created_at))}`,
    content,
  })
}
