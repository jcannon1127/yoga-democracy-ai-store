import categoriesData from "../../content/categories.json"

/**
 * Search over the catalogue, including MOTIF.
 *
 * The hard part of search here is not matching, it is the corpus. YD merchandises by motif: a
 * customer types "octopus" and expects *Anywhere Flare - Clever Koi*, whose title contains
 * neither word. The live site's own answer to that is a category at
 * `/animal/aquatic%2C-fish%2C-octopus%2C-carp%2C-koi/` — so the motif vocabulary already
 * exists, encoded in the category paths yd-cat scraped. Searching titles alone would look
 * correct in a test and feel broken to a YD shopper.
 *
 * So a product's searchable text is its title PLUS the words of every category it belongs to.
 * Title matches outrank motif matches, because someone typing "om tank" wants the Om Tank,
 * not everything shelved beside it.
 *
 * No Algolia and no index server: 552 products is a few hundred kilobytes of strings, and the
 * category data is already imported at build time.
 */

type Category = { path: string; heading?: string | null; products?: string[] }

const CATEGORIES: Category[] = (categoriesData as { categories: Category[] }).categories ?? []

/** Words too common in this catalogue to narrow anything. */
const STOP = new Set([
  "the", "and", "a", "an", "of", "in", "for", "with", "shop", "collections",
  "collection", "all", "yd", "yoga", "democracy", "printed", "eco", "friendly",
  "womens", "women", "s",
])

/**
 * Category paths are URL-encoded (`aquatic%2C-fish`), so they need decoding — but
 * decodeURIComponent throws URIError on a lone `%`, which a heading like "50% off" contains.
 * An unguarded decode here would 500 the entire search page on one bad character.
 */
const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

export const tokenize = (text: string): string[] =>
  safeDecode(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP.has(t))

/** "leggings" and "legging" should be the same term. Deliberately crude — no stemmer. */
const singular = (term: string) =>
  term.length > 3 && term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term

const normalise = (terms: string[]) => terms.map(singular)

/**
 * handle -> motif/category terms. Built once per process.
 *
 * `/shop/tops` contributes "tops"; `/animal/aquatic,-fish,-octopus,-carp,-koi` contributes
 * "aquatic", "fish", "octopus", "carp", "koi" — which is what makes the octopus case work.
 */
let motifTerms: Map<string, Set<string>> | null = null

const getMotifTerms = (): Map<string, Set<string>> => {
  if (motifTerms) return motifTerms
  const map = new Map<string, Set<string>>()

  for (const category of CATEGORIES) {
    const terms = new Set(
      normalise([...tokenize(category.path), ...tokenize(category.heading ?? "")])
    )
    if (!terms.size) continue
    for (const handle of category.products ?? []) {
      const existing = map.get(handle)
      if (existing) {
        terms.forEach((t) => existing.add(t))
      } else {
        map.set(handle, new Set(terms))
      }
    }
  }

  motifTerms = map
  return map
}

export type Searchable = {
  handle: string
  title?: string | null
  metadata?: Record<string, unknown> | null
}

const TITLE_WEIGHT = 3
const MOTIF_WEIGHT = 1

/**
 * Rank products against a query.
 *
 * Every query term must match SOMEWHERE on the product — "octopus legging" should not return
 * every legging. Ranking then favours title matches so exact product names come first.
 */
export function searchProducts<T extends Searchable>(
  products: T[],
  query: string
): T[] {
  const terms = normalise(tokenize(query))
  if (!terms.length) return []

  const motif = getMotifTerms()
  const scored: { product: T; score: number }[] = []

  for (const product of products) {
    const titleTerms = new Set(
      normalise([
        ...tokenize(product.title ?? ""),
        ...tokenize(String((product.metadata as any)?.print_name ?? "")),
      ])
    )
    const productMotif = motif.get(product.handle) ?? new Set<string>()

    let score = 0
    const matchedAll = terms.every((term) => {
      // Prefix matching, so "octo" finds "octopus" and "legg" finds "leggings".
      const inTitle = [...titleTerms].some((t) => t.startsWith(term) || term.startsWith(t))
      const inMotif = [...productMotif].some((t) => t.startsWith(term) || term.startsWith(t))
      if (inTitle) score += TITLE_WEIGHT
      else if (inMotif) score += MOTIF_WEIGHT
      return inTitle || inMotif
    })

    if (matchedAll) {
      // A photographed product outranks an identical unphotographed one; 185 of 552 have no
      // image and a page of blanks reads as broken.
      scored.push({ product, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.product)
}
