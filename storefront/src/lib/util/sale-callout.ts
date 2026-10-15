/**
 * The warehouse-sale callout's TYPE and its matching rule — deliberately free of `fs`.
 *
 * This lives here rather than beside the loader in lib/content/site-chrome.ts because
 * ProductActions is a CLIENT component. Importing anything from that module into it pulls
 * Node's `fs` into the client bundle and the build fails with "Module not found: Can't
 * resolve 'fs'". Reading content is a server concern; deciding whether a price matches a tier
 * is a pure function, and only the second belongs on the client.
 */
export type SaleCallout = { amount: number; label: string }

/**
 * The label for a price, or null when no tier matches.
 *
 * Compared in whole cents: the tiers are written as 10 and 20 in JSON while prices arrive as
 * floats, and 20.000000000000004 === 20 is false.
 *
 * An unrecognised price renders NOTHING rather than guessing. That is the failure that
 * matters — a wrong tier on a product page is a wrong price claim to a customer, whereas a
 * missing line is just the page we ship today.
 */
export const saleCalloutFor = (
  amount: number | null | undefined,
  tiers: SaleCallout[]
): string | null => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null
  const hit = tiers.find((t) => Math.round(t.amount * 100) === Math.round(amount * 100))
  return hit ? hit.label : null
}
