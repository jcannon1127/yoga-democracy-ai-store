import registry from "../../content/categories.json"

/**
 * The browse pages the live site has: /shop/tops, /collections/botanical, /solids/jet-black,
 * /new, /best-sellers, /warehouse-sale, the animal and insect motif pages, and the campaign
 * landings. Copy, hero art and membership all come from src/content/categories.json, which is
 * scraped from the live site by scripts/sfcc_category_scrape.py — so a page can be retitled or
 * re-merchandised without a deploy, and nothing about Yoga Democracy is compiled into JSX.
 */
export type BrowseCategory = {
  path: string
  kind: string
  sfcc_cgid: string | null
  live_url: string
  seo_title: string | null
  seo_description: string | null
  heading: string | null
  copy: string | null
  hero: string | null
  hero_remote?: string | null
  /** The colour the LIVE page sets on its hero heading, when it sets one. */
  hero_text_color?: string | null
  /** Luminance verdict for the artwork behind the caption, from yd-store's sampler. */
  heroTextColor?: "light" | "dark"
  live_result_count: number | null
  sfcc_hides_soldout: boolean
  products: string[]
  missing_from_medusa?: string[]
}

const CATEGORIES = registry.categories as BrowseCategory[]

/**
 * SFCC's motif URLs carry encoded commas — /animal/aquatic%2C-fish%2C-octopus%2C-carp%2C-koi.
 * Next hands route params over already decoded, and the registry stores them as the live site
 * writes them, so both sides are decoded before they are compared. Get this wrong and nine
 * perfectly good pages 404.
 */
function normalise(path: string): string {
  const decoded = path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join("/")
  return ("/" + decoded.replace(/^\/+|\/+$/g, "")).toLowerCase()
}

const BY_PATH = new Map(CATEGORIES.map((c) => [normalise(c.path), c]))

export function findBrowseCategory(segments: string[]): BrowseCategory | undefined {
  return BY_PATH.get(normalise(segments.join("/")))
}

export function allBrowseCategories(): BrowseCategory[] {
  return CATEGORIES
}

/** The path as a router link: encoded again, and without the country prefix. */
export function browseHref(category: BrowseCategory): string {
  return (
    "/" +
    category.path
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/")
  )
}

/**
 * The motif pages ship an empty <h1> on the live site — the heading is the category name and
 * SFCC renders it from the page title. Falling back to the SEO title keeps "Butterfly" on the
 * butterfly page instead of a blank banner.
 */
export function headingFor(category: BrowseCategory): string {
  if (category.heading) return category.heading
  if (category.seo_title) return category.seo_title.split("|")[0].trim()
  const last = decodeURIComponent(category.path.split("/").pop() || "")
  return last
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
