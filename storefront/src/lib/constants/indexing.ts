/**
 * Whether this deployment may be indexed by search engines.
 *
 * ONE switch, deliberately. The preview lock lives in two places that must agree -- the
 * `robots` metadata in src/app/layout.tsx and the disallow in src/app/robots.ts -- and both
 * are needed: a robots.txt disallow alone does NOT remove a URL Google already knows about,
 * it only stops the crawl, so the URL can still be listed. Two files that must change
 * together are two files where somebody changes one, and the two failure modes are
 * asymmetric and both bad: flip only the meta tag and the crawler never arrives; flip only
 * robots.txt and it arrives to be told noindex on every page.
 *
 * Off by default. yd.thisisus.ai serves YD's real catalogue and real prices, and an
 * indexable duplicate a month before an SEO migration would compete with the live site for
 * its own rankings. Turning it on is a decision someone makes on the day, by setting
 * YD_PUBLIC_SITE=true in the environment and rebuilding -- not a code change made in a hurry
 * that morning.
 */
export const SITE_IS_PUBLIC = process.env.YD_PUBLIC_SITE === "true"
