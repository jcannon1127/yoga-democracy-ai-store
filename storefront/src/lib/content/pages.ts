import fs from "fs"
import path from "path"

export const CONTENT_PAGES_DIR = path.join(process.cwd(), "src/content/pages")

/**
 * The content pages that actually have a URL.
 *
 * `<slug>.additions.json` files are overlays merged into their parent page, not pages of
 * their own -- `/pages/size-chart.additions` 404s, correctly. Listing them anywhere that
 * asserts "these are our pages" would put 404s in the sitemap, which is a quality signal a
 * crawler holds against the whole site.
 *
 * Shared by the sitemap and the content route so there is one answer to "which pages exist".
 */
export const listContentPageSlugs = (): string[] => {
  if (!fs.existsSync(CONTENT_PAGES_DIR)) return []
  return fs
    .readdirSync(CONTENT_PAGES_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".additions.json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
}
