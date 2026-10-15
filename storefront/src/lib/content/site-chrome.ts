import fs from "fs"
import path from "path"

import { SaleCallout } from "@lib/util/sale-callout"

const FILE = path.join(process.cwd(), "src/content/site-chrome.json")

/**
 * The whole chrome file, read from DISK at request time — never `import`ed.
 *
 * An imported JSON is inlined by the bundler at build time, which means changing the
 * announcement bar, a hero slide or a nav label needs a rebuild and a deploy. That defeats
 * the entire reason this content lives in a file: I told Jeff repeatedly that the merchandising team could
 * swap a time-limited sale creative without a deploy, and as built that was FALSE. The
 * `import` is the natural thing to write and it silently removes the capability. Caught by
 * yd-email hitting the same trap in the order-confirmation template.
 *
 * Cached briefly so a page render is not several disk reads, short enough that an edit is
 * live within a minute.
 */
const TTL_MS = 30_000
let cache: { at: number; value: Record<string, any> } | null = null

export function readSiteChrome(): Record<string, any> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.value
  try {
    const value = JSON.parse(fs.readFileSync(FILE, "utf-8"))
    cache = { at: now, value }
    return value
  } catch (error) {
    // A missing or malformed content file must not take the site down — but it must be
    // loud, because "no announcement bar" and "could not read the content file" look
    // identical on the page and are completely different problems.
    console.error("[site-chrome] could not read content file; chrome will be empty", error)
    return {}
  }
}

type SiteChrome = {
  backorder?: { message?: string }
}

/**
 * Business copy that is data, not code.
 *
 * The backorder lead time — "ships in 10–14 days" — is a **public promise Jeff has
 * personally signed off**, and it is the kind of promise that changes: it shortens when
 * ShipCalm's receiving catches up, and it has to be correctable in minutes if Kenya slips.
 * Copy like that does not belong in a component, where changing it means a code review of
 * TypeScript to alter eleven characters.
 *
 * Read at request time rather than imported, so the value is not frozen into a client
 * bundle. **One honest caveat**: product pages are statically generated, so an edit here
 * still needs a rebuild to reach visitors — it is a content change rather than a code
 * change, not a live one. Making it genuinely instant needs revalidation on the product
 * route, which is a separate decision from this copy.
 *
 * Falls back to a message that promises nothing if the file is missing or malformed. A
 * missing content file must never take a product page down, and it must never silently
 * invent a delivery date.
 */
const FALLBACK = "On backorder — not in stock today"

export const backorderMessage = (): string => {
  try {
    const chrome: SiteChrome = JSON.parse(fs.readFileSync(FILE, "utf-8"))
    const message = chrome.backorder?.message?.trim()
    return message || FALLBACK
  } catch {
    return FALLBACK
  }
}

/**
 * The warehouse-sale tiers behind the coloured line above the price — "$20 Bottoms",
 * "$10 Tops". Server-side: this reads the content file.
 *
 * Keyed on the sale price alone, because that is what the live site does. Measured across 45
 * live product pages: $10.00 always reads "$10 Tops" (10 of 10), $20.00 always reads
 * "$20 Bottoms" (20 of 20), and no callout appears at any of the eight other sale prices in
 * the sample. Price is also the safe key — `config/promotions.yd.json` warns that sale
 * membership must never be derived from the warehouse-sale category, because 8 products are
 * discounted while sitting outside it.
 *
 * Every entry is validated rather than trusted: a tier with a missing label or a non-numeric
 * amount is dropped, not rendered. Returns [] on any read or shape problem, for the same
 * reason the backorder copy falls back to a promise-free string — a malformed content file
 * must not take a product page down, and it must never invent a price claim.
 */
export const saleCallouts = (): SaleCallout[] => {
  try {
    const tiers = (readSiteChrome() as any)?.sale_callouts?.tiers
    if (!Array.isArray(tiers)) return []
    return tiers.filter(
      (t: any) =>
        typeof t?.amount === "number" &&
        Number.isFinite(t.amount) &&
        typeof t?.label === "string" &&
        t.label.trim().length > 0
    )
  } catch {
    return []
  }
}
