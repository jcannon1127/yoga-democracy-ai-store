import { Suspense } from "react"

import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import { BrowseCategory, headingFor } from "@lib/util/browse-categories"
import { BrowseSort } from "@lib/util/browse-sort"
import { Selection } from "@lib/util/browse-facets"
import BrowseProducts from "./browse-products"

/**
 * A browse page, laid out the way the live site lays one out: hero art where the category has
 * it, the heading and its paragraph of copy, the result count centred, the sort control on the
 * left below it, then the grid — two up on a phone, three up above that.
 *
 * There is no filter rail. The live category pages do not have one either.
 */
/**
 * What colour the hero caption should be, in order of authority.
 *
 * 1. THE COLOUR THE LIVE PAGE SETS. 10 of the 35 hero pages set one inline, and they are not
 *    one brand colour — each pale page uses its own colourway (Twig #52422f, Mulberry #4e2540,
 *    Nocturnal #606180), values that independently match the nav swatches. Parity means using
 *    the page's own colour, not a house dark green.
 * 2. WHERE LIVE SETS NOTHING BUT THE ARTWORK IS PALE, a dark caption anyway. the operations agent
 *    measured the mean luminance of the region the text sits on across all 35 heroes; that
 *    method and this scrape agree on 10 of 11 pages, which is the strongest corroboration
 *    either has. The one they disagree about is /polka-dot-in-dreamcloud-launch-sale, where
 *    the artwork is pale and live still renders white — unreadable on the live site too.
 *    Matching that faithfully would reproduce a defect, and unreadable text is a defect rather
 *    than a difference: the same reasoning that removed the text-shadow.
 * 3. Otherwise white, which is right over the 24 dark photographs.
 */
function heroCaptionColour(category: BrowseCategory): string {
  if (category.hero_text_color) return category.hero_text_color
  if (category.heroTextColor === "dark") return "#324140"
  return "#ffffff"
}

export default function BrowseTemplate({
  category,
  sort,
  show,
  selection,
  countryCode,
}: {
  category: BrowseCategory
  sort: BrowseSort
  show: number
  selection: Selection
  countryCode: string
}) {
  const heading = headingFor(category)

  const banner = (
    <div className="text-center">
      {/* The live banner sets the heading in caps with wide tracking and the paragraph
          beneath it in lower case. Both are CSS transforms there, so the content file keeps
          the human-readable casing and the styling does the rest — which also means a
          heading the merchandising team types stays readable in the JSON. */}
      <h1 className="text-2xl-semi pt-3 yd-category-heading" data-testid="browse-title">
        {heading}
      </h1>
      {category.copy && (
        <h2 className="text-base-regular pt-3 max-w-4xl mx-auto whitespace-pre-line lowercase">
          {category.copy}
        </h2>
      )}
    </div>
  )

  return (
    <div data-testid="browse-container">
      {category.hero ? (
        // The live site sets the heading and copy OVER the hero image in white, centred —
        // not above the grid underneath it. On the 35 pages that have hero art that is the
        // most visible difference between the two sites, and it changes what the page looks
        // like at a glance rather than in detail.
        //
        // Plain <img>, not next/image: these are pre-sized SFCC exports at the width the
        // banner renders, and they are full-bleed, so there is nothing for the optimiser to
        // decide. Caption colour is per-category, from `heroTextColor` in categories.json,
        // which is computed from the mean luminance of the centre of each hero image (the
        // region the text sits on). 11 of the 35 heroes are pale enough that white is
        // unreadable — Inseam Update measures 248/255 — and the live site sets those in dark
        // green. Light captions keep a soft shadow the live site does not have; dark ones do
        // not need it. Do not hardcode a colour here: the artwork changes per campaign.
        <div className="relative overflow-hidden min-h-[220px] min-[768px]:min-h-[300px]">
          <img
            src={category.hero}
            alt={heading}
            className="absolute inset-0 w-full h-full object-cover"
            data-testid="browse-hero"
          />
          {/* The caption sizes the banner and the artwork COVERS it, rather than the artwork
              sizing the banner and the caption overflowing.
              Measured at a true 390: the heroes are wide crops, so at phone width they are
              only 93-106px tall while the caption runs 144-288px. Overlaying on the image's
              own height put two thirds of the Warehouse Sale copy BELOW the artwork — white
              text on a white page, invisible. It looked fine at 1440 and fine in a 500px
              screenshot; only the box measurements showed it.
              A min-height keeps short captions from collapsing the band on wide screens. */}
          {/* Colour comes from the live page, per page — it is not always white.
              /shop/inseam-update is a near-white studio shot and live sets its heading and
              copy to dark green (#2e4f47); most other heroes are dark photographs with no
              colour set, where white is right. Hardcoding white made that page's copy almost
              invisible on the preview, and the text-shadow I had added as insurance only made
              it "sort of" readable — which is worse than obviously wrong, because it hides the
              defect instead of showing it. The shadow is gone: live does not use one, and with
              the right colour per page it is not needed. */}
          <div
className="relative flex flex-col items-center justify-center min-h-[220px] min-[768px]:min-h-[300px] px-6 py-8"
            style={{ color: heroCaptionColour(category) }}
            data-testid="browse-hero-caption"
            data-hero-text={category.heroTextColor ?? "light"}
          >
            {banner}
          </div>
        </div>
      ) : null}

      <div className="content-container py-6">
        {!category.hero && <div className="text-ui-fg-base">{banner}</div>}

        <Suspense fallback={<SkeletonProductGrid />}>
          {/* The count is rendered with the grid, not here: it is the number of products
              Medusa actually returns, not the number the live site advertises. */}
          <div className="pt-6">
            <BrowseProducts
              category={category}
              sort={sort}
              show={show}
              selection={selection}
              countryCode={countryCode}
            />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
