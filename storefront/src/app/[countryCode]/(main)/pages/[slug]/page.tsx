import fs from "fs"
import path from "path"
import { Metadata } from "next"
import { notFound } from "next/navigation"
import PageBlocks, { Block } from "@modules/content/components/page-blocks"
import { STORE_NAME } from "@lib/constants/store"
import { listContentPageSlugs } from "@lib/content/pages"

const DIR = path.join(process.cwd(), "src/content/pages")

/**
 * Rendered per request, not prerendered.
 *
 * These pages are static content, so `generateStaticParams` looks obviously right — and it
 * is what broke every content page in production with `DYNAMIC_SERVER_USAGE`. The shared
 * (main) layout reads cookies (cart id, Medusa cache id), so a page under it cannot be
 * statically rendered. Dev tolerates the mismatch; a production build does not, which is
 * why this passed every check until the site was actually built.
 *
 * Precisely (yd-cat's diagnosis, which is sharper than mine): generateStaticParams lists
 * slugs but NOT country codes, so /us/pages/about-us is not in the prerendered set and
 * Next generates it on demand as a prerender — where cookie reads are not allowed.
 *
 * generateStaticParams is kept below because it still gives Next the slug list, but the
 * route is explicitly dynamic. The content is read from disk, so there is nothing to gain
 * from prerendering it anyway.
 */
export const dynamic = "force-dynamic"

type ContentPage = {
  slug: string
  title: string
  description: string
  source_url: string
  blocks: Block[]
}

const read = (slug: string): ContentPage | null => {
  // Guard the path: the slug comes from the URL.
  if (!/^[a-z0-9-]+$/.test(slug)) return null
  const file = path.join(DIR, `${slug}.json`)
  if (!fs.existsSync(file)) return null
  const page: ContentPage = JSON.parse(fs.readFileSync(file, "utf-8"))

  // Content we add that the live site does not have lives in a sibling *.additions.json,
  // because the extractor overwrites the main file wholesale — it silently dropped an
  // approved section once. Extracted content and authored content stay separate.
  const extra = path.join(DIR, `${slug}.additions.json`)
  if (fs.existsSync(extra)) {
    const added = JSON.parse(fs.readFileSync(extra, "utf-8"))
    page.blocks = [...page.blocks, ...(added.blocks ?? [])]
    // Some live pages have a generic <title> (the size chart is titled with the site name),
    // so the authored file can override it. Same reason as the blocks: the extractor
    // overwrites the generated file and any edit made there is lost on the next run.
    if (added.title) page.title = added.title
    if (added.description) page.description = added.description

    // Copy corrections against extracted text. The extracted files are generated and get
    // overwritten wholesale, so an edit made there is lost on the next run — this is the
    // third time that has mattered. Corrections live here instead.
    //
    // These exist because copy lifted verbatim from the live site carries the live site's
    // assumptions. US-only is a NEW constraint the original copy never had, so the live
    // wording promises things this site cannot deliver.
    for (const rule of added.replacements ?? []) {
      page.blocks = page.blocks.map((b: any) =>
        b.text ? { ...b, text: b.text.split(rule.find).join(rule.replace) } : b
      )
    }
    for (const rule of added.drop_blocks ?? []) {
      page.blocks = page.blocks.filter(
        (b: any) => !(b.text && b.text.includes(rule.contains))
      )
    }
  }
  return page
}

export async function generateStaticParams() {
  return listContentPageSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await props.params
  const page = read(slug)
  if (!page) return {}
  // The live <title> already ends in the store name; strip it so the root template's
  // suffix does not double up.
  const bare = page.title.split("|")[0].trim()
  return { title: bare || STORE_NAME, description: page.description }
}

export default async function ContentPageRoute(props: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await props.params
  const page = read(slug)

  if (!page) {
    notFound()
  }

  return (
    <div className="content-container py-6">
      <PageBlocks blocks={page.blocks} />
    </div>
  )
}
