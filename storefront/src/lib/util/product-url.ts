export const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"

/**
 * Whether the default region is served at the BARE path (`/products/x`) or at the prefixed
 * one (`/us/products/x`).
 *
 * **DEFAULT ON since 2026-08-25 — Jeff dropped the `/us/` prefix.** It stays a flag, and this
 * stays the only place the shape is decided, because "we can add it back down the road" is the
 * condition attached to that decision: a second region, and this goes to `"false"` again.
 *
 * The default is in the code because `.env.local` is gitignored: an opt-in flag meant every
 * other lane built a storefront that emitted a different URL shape than production, silently.
 *
 * Every URL the app EMITS reads it from here, via `regionPath()` — canonicals, structured
 * data, the sitemap, internal links, redirects after checkout. The alternative is hunting all
 * of them by hand and finding all but one, which is exactly how the previous flip left the
 * canonical pointing at a URL that only redirected.
 *
 * Must agree with the middleware's `YD_SERVE_BARE_PATHS`. They are two flags because one is
 * read in the browser bundle and one on the edge; set them together or the site advertises
 * URLs it does not serve.
 */
export const DEFAULT_REGION_IS_BARE =
  process.env.NEXT_PUBLIC_DEFAULT_REGION_BARE_PATH !== "false"

/**
 * The same decision as seen by the MIDDLEWARE, which serves the shape the app emits.
 *
 * It lives here, next to the flag it must agree with, rather than as a second `!== "0"` in
 * middleware.ts. Two independent default expressions in two files agree today and drift the
 * first time someone edits one of them — and the build guard in `check-env-variables.js`
 * cannot catch that case, because it only fires when a flag is set EXPLICITLY. One expression
 * cannot disagree with itself. (yd-accounts spotted the gap.)
 *
 * Two env vars remain because one must be inlined into the browser bundle and one is read on
 * the edge; what is shared is the DEFAULT and the meaning.
 */
export const SERVE_BARE_PATHS = process.env.YD_SERVE_BARE_PATHS !== "0"

/**
 * A path within a region, in whichever URL shape is current.
 *
 * `regionPath("us", "/shop/tops")` -> `/shop/tops` bare, `/us/shop/tops` prefixed. Any country
 * that is not the default region always keeps its prefix — the bare shape is only ever the
 * DEFAULT region's, or two regions would collide on the same URL.
 */
export const regionPath = (countryCode: string, path: string) => {
  const clean = path === "/" ? "" : path
  return DEFAULT_REGION_IS_BARE && countryCode === DEFAULT_REGION
    ? clean || "/"
    : `/${countryCode}${clean}`
}

/**
 * The one canonical path for a product page.
 *
 * Getting this wrong is not cosmetic. A canonical tag asserts "this is the address of this
 * page" — point it at a URL that redirects and it is worse than having no canonical at all,
 * which defeats the reason it was added (collapsing the `?v_id=` duplicates the size
 * dropdown generates). Yotpo's `data-url` has the same property: it is the address reviews
 * are filed and linked against.
 */
export const productPath = (countryCode: string, handle: string) =>
  regionPath(countryCode, `/products/${handle}`)

export const productUrl = (baseUrl: string, countryCode: string, handle: string) =>
  `${baseUrl.replace(/\/$/, "")}${productPath(countryCode, handle)}`
