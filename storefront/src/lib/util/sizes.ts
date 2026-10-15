/**
 * Size and length presentation for the product page.
 *
 * Two facts the catalogue does not carry, and the PDP has to supply:
 *
 * 1. **Medusa stores `XXS` / `XXL` / `XXXL`; the live site shows `2XS` / `2XL` / `3XL`.**
 *    The stored value comes from the SKU (`1504XXXL88`), so it stays the identity we match
 *    variants on. Only the label changes.
 *
 * 2. **Option values arrive unordered.** Medusa returns `rank: null` on every option value
 *    in this catalogue, so `option.values` is in insertion order — which puts L before S on
 *    plenty of products. A size dropdown that reads XS, XXL, M, S is the kind of detail that
 *    makes a shop look broken, so sort explicitly rather than trusting the array.
 *
 * The run itself is YD's (2XS-3XL, and lengths Standard 28" / Extra Long 32"). Logged in
 * docs/seams.md — another brand's run would be different data, not different code.
 */

const SIZE_LABELS: Record<string, string> = {
  XXS: "2XS",
  XXL: "2XL",
  XXXL: "3XL",
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]

/**
 * Lengths sort by their actual inseam, read out of the label.
 *
 * There is no fixed list to enumerate, and enumerating one is how this breaks: the length
 * merge introduced Short (30") / Regular (32") / Long (34") for trousers and
 * Standard (32") / Tall (36") for Pocket Bells, alongside the leggings' original
 * Standard (28") / Extra Long (32"). A hardcoded pair silently fell through to alphabetical,
 * which orders trousers **Long, Regular, Short** — longest first, and the words in reverse.
 *
 * The number in the label is the fact; the word in front of it is a name for that number.
 * Sorting on the number handles every set YD has and any set it adds.
 */
const inseamOf = (value: string): number | null => {
  const match = value.match(/(\d+(?:\.\d+)?)\s*"/)
  return match ? parseFloat(match[1]) : null
}

/** Smallest first. Values outside the known run sort last, alphabetically among themselves. */
export const compareSizes = (a: string, b: string) => {
  const ia = SIZE_ORDER.indexOf(a)
  const ib = SIZE_ORDER.indexOf(b)
  if (ia === -1 && ib === -1) return a.localeCompare(b)
  if (ia === -1) return 1
  if (ib === -1) return -1
  return ia - ib
}

export const compareLengths = (a: string, b: string) => {
  const ia = inseamOf(a)
  const ib = inseamOf(b)
  if (ia !== null && ib !== null) return ia - ib
  // A label with no inseam in it sorts last rather than scrambling the ones that have one.
  if (ia !== null) return -1
  if (ib !== null) return 1
  return a.localeCompare(b)
}

/** `XXXL` -> `3XL`. Anything unrecognised is shown exactly as stored. */
export const sizeLabel = (value: string) => SIZE_LABELS[value] ?? value

/**
 * Sort an option's values for display. Size and Length each have a natural order; anything
 * else falls back to alphabetical, which at least is stable.
 */
export const sortOptionValues = (optionTitle: string, values: string[]) => {
  const title = optionTitle.trim().toLowerCase()
  const cmp =
    title === "size"
      ? compareSizes
      : title === "length"
      ? compareLengths
      : (a: string, b: string) => a.localeCompare(b)
  return [...values].sort(cmp)
}

/** The label to print for a value of the given option. Only Size is rewritten today. */
export const optionValueLabel = (optionTitle: string, value: string) =>
  optionTitle.trim().toLowerCase() === "size" ? sizeLabel(value) : value

/**
 * Size first, then Length — the order the live product page uses.
 *
 * 29 products carry both options and the import produced them in *both* orders: 12 as
 * (Size, Length) and 17 as (Length, Size). Presenting whichever order the API happened to
 * return would ask some customers to pick a length before a size.
 */
export const sortProductOptions = <T extends { title?: string | null }>(options: T[]) => {
  const rank = (t?: string | null) => {
    const title = (t ?? "").trim().toLowerCase()
    if (title === "size") return 0
    if (title === "length") return 1
    return 2
  }
  return [...options].sort((a, b) => rank(a.title) - rank(b.title))
}
