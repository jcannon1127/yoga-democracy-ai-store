import Image from "next/image"
import { Heading } from "@medusajs/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import tiles from "../../../../content/home-tiles.json"

type Tile = { label: string; href: string; images: string[] }

/**
 * The live homepage's category tiles and solids strip.
 *
 * Art and destinations are content (`home-tiles.json`, handed over by yd-cat with every
 * destination checked against the browse registry). Only five of the eighteen solid
 * colourways appear on the live strip — it is a merchandised selection, not the palette — so
 * the five come from content rather than being derived from the colour list, or the strip
 * drifts the first time the merchandising team changes it.
 */

/**
 * Pick art by FILENAME, not by array position.
 *
 * The content file lists [mobile, desktop] for three tiles and [desktop, mobile] for the
 * fourth. Trusting the order would silently swap one tile's artwork — no error, just the
 * wrong picture on Bells & Flares, and only on one breakpoint.
 */
const art = (images: string[]) => {
  const mobile = images.find((i) => i.includes("/mob-"))
  const desktop = images.find((i) => !i.includes("/mob-"))
  return { mobile: mobile ?? desktop, desktop: desktop ?? mobile }
}

function TileImage({ tile, sizes }: { tile: Tile; sizes: string }) {
  const { mobile, desktop } = art(tile.images)
  return (
    <>
      <Image
        src={desktop!}
        alt={tile.label}
        width={800}
        height={800}
        sizes={sizes}
        className="hidden small:block w-full h-auto"
      />
      <Image
        src={mobile!}
        alt={tile.label}
        width={800}
        height={800}
        sizes={sizes}
        className="small:hidden w-full h-auto"
      />
    </>
  )
}

export default function CategoryTiles() {
  const all = (tiles as { tiles: Tile[] }).tiles ?? []
  const categories = all.filter((t) => !t.href.startsWith("/solids/"))
  const solids = all.filter((t) => t.href.startsWith("/solids/"))

  if (!categories.length && !solids.length) return null

  return (
    <div className="content-container py-10 small:py-16 flex flex-col gap-y-14">
      {categories.length > 0 && (
        <ul className="grid grid-cols-2 medium:grid-cols-4 gap-4 small:gap-6">
          {categories.map((tile) => (
            <li key={tile.href}>
              <LocalizedClientLink href={tile.href} className="group block">
                <TileImage tile={tile} sizes="(max-width: 1024px) 50vw, 25vw" />
                <span className="sr-only">{tile.label}</span>
              </LocalizedClientLink>
            </li>
          ))}
        </ul>
      )}

      {solids.length > 0 && (
        <div>
          <div className="flex items-end justify-between mb-6">
            <Heading level="h2" className="text-2xl-semi text-ui-fg-base">
              Solids
            </Heading>
            <LocalizedClientLink
              href="/solids"
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover txt-medium"
            >
              View all →
            </LocalizedClientLink>
          </div>
          {/* The live strip is a swiper showing 2 / 4 / 5 across. A scroll-snap row does the
              same job with no JavaScript and stays swipeable by touch. */}
          <ul className="flex gap-4 small:gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory">
            {solids.map((tile) => (
              <li
                key={tile.href}
                className="snap-start shrink-0 w-1/2 small:w-1/4 medium:w-1/5"
              >
                <LocalizedClientLink href={tile.href} className="group block">
                  <TileImage tile={tile} sizes="(max-width: 1024px) 50vw, 20vw" />
                  <span className="block text-center txt-compact-medium mt-3 text-ui-fg-base group-hover:text-ui-fg-interactive">
                    {tile.label}
                  </span>
                </LocalizedClientLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
