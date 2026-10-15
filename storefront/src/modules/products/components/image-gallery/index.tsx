"use client"

import { HttpTypes } from "@medusajs/types"
import { clx } from "@medusajs/ui"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
  /** Used for alt text — a gallery of "Product image 3" is useless to a screen reader. */
  title?: string
}

/**
 * The product carousel: one large image, arrows, dots, and hover-to-zoom.
 *
 * The starter stacked every image vertically, so a four-image product made the page four
 * screens tall and pushed the buy box off-screen on a phone. The live site shows one image
 * at a time in a carousel — that is both the parity target and the better layout.
 *
 * Images that fail to load are dropped rather than rendered as an empty frame — see the
 * filter below. The gallery treats a missing file as normal, because it is.
 *
 * Zoom copies what `js-image-zoom` does on the live page: magnify in place on hover,
 * tracking the cursor. **Pointer-only, and enforced rather than assumed** — touch browsers
 * synthesise mouse events, so without the guard a tap on a phone zooms the image and leaves
 * it stuck, because no mouseleave ever arrives. Pinch-zoom already covers that need.
 */
const ImageGallery = ({ images: supplied, title }: ImageGalleryProps) => {
  const [index, setIndex] = useState(0)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [zooming, setZooming] = useState(false)
  const [origin, setOrigin] = useState({ x: 50, y: 50 })
  const [canZoom, setCanZoom] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)

  // Zoom only where there is a real pointer. Touch browsers synthesise mouse events, so on a
  // phone a tap fires mouseenter/mousemove and scales the image 1.8x — and then never fires
  // mouseleave, so it stays zoomed with no way back. Checked after mount rather than during
  // render because it reads the browser, and the server has no pointer.
  useEffect(() => {
    setCanZoom(window.matchMedia("(hover: hover) and (pointer: fine)").matches)
  }, [])

  /**
   * Drop images that fail to load, rather than showing an empty frame.
   *
   * Two of 2,033 image URLs in the catalogue are 404s today, and both are in **first**
   * position — so those products open on a blank. The data fix belongs upstream, but the
   * gallery should not depend on the catalogue being perfect: a missing file is a normal
   * thing to survive, not an exception. A product with one dead photo now shows its other
   * photos; a product whose photos are all dead shows the placeholder, same as one with no
   * photos at all.
   *
   * Client-side because only the browser finds out — the URL exists, the bytes do not.
   */
  const images = supplied.filter((image) => !broken.has(image.id))
  const count = images.length

  const markBroken = useCallback((id: string) => {
    setBroken((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  // Dropping an image can leave the index past the end.
  useEffect(() => {
    if (index > 0 && index >= count) {
      setIndex(Math.max(0, count - 1))
    }
  }, [index, count])

  const go = useCallback(
    (next: number) => {
      if (!count) return
      setIndex(((next % count) + count) % count)
      setZooming(false)
    },
    [count]
  )

  // Arrow keys move through the gallery once it has focus.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(index - 1)
      if (e.key === "ArrowRight") go(index + 1)
    }
    frame.addEventListener("keydown", onKey)
    return () => frame.removeEventListener("keydown", onKey)
  }, [go, index])

  if (!count) {
    // No image is a catalogue gap, not an error. Hold the column's shape so the buy box
    // does not jump left on the products that have none.
    return (
      <div
        className="relative w-full aspect-[29/34] bg-ui-bg-subtle"
        data-testid="product-image-placeholder"
      />
    )
  }

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setOrigin({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    })
  }

  return (
    <div className="flex flex-col gap-y-3" data-testid="product-gallery">
      <div
        ref={frameRef}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={title ? `${title} images` : "Product images"}
        className="relative w-full aspect-[29/34] overflow-hidden bg-ui-bg-subtle outline-none focus-visible:ring-1 focus-visible:ring-ui-border-interactive"
        onMouseEnter={canZoom ? () => setZooming(true) : undefined}
        onMouseLeave={canZoom ? () => setZooming(false) : undefined}
        onMouseMove={canZoom ? onMove : undefined}
      >
        {images.map((image, i) => (
          <Image
            key={image.id}
            src={image.url}
            alt={
              title
                ? `${title}${i > 0 ? ` — view ${i + 1}` : ""}`
                : `Product image ${i + 1}`
            }
            fill
            priority={i === 0}
            onError={() => markBroken(image.id)}
            /*
             * Describe the REAL displayed width, or the browser over-fetches.
             *
             * "45vw" ignores that `content-container` caps at 1440px, so on a 2560px monitor
             * the browser computed 1152 CSS px, doubled it for a retina screen and picked the
             * 3840w variant — 272 KB for an image that is never drawn wider than 600 CSS px.
             * The correct source at 2x is 1200w, which is 86 KB. Same visible detail, 68%
             * fewer bytes, on the largest images on the site.
             *
             * The breakpoints mirror the column widths in the product template: full bleed on
             * a phone, 7/12 at md, then a flat 600px — the container caps at 1440 and the
             * gallery column is 5/12 of that minus padding and gap, so it never draws wider
             * than about 580 CSS px however large the display. Stating 42vw instead cost a
             * jump to the 1920w variant at exactly 1440px, for ten pixels nobody sees.
             */
            sizes="(max-width: 767px) 100vw, (max-width: 1023px) 58vw, 600px"
            className={clx(
              "object-cover transition-opacity duration-200",
              i === index ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            style={
              i === index && zooming && canZoom
                ? {
                    transform: "scale(1.8)",
                    transformOrigin: `${origin.x}% ${origin.y}%`,
                    transition: "transform 150ms ease-out",
                  }
                : undefined
            }
          />
        ))}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-white/80 hover:bg-white rounded-full text-ui-fg-base"
              data-testid="gallery-prev"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next image"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-white/80 hover:bg-white rounded-full text-ui-fg-base"
              data-testid="gallery-next"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-x-1.5 py-1" role="tablist" aria-label="Choose image">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Image ${i + 1} of ${count}`}
              onClick={() => go(i)}
              /* Short bars, not dots — the live carousel uses bars, confirmed in a
                 side-by-side capture of the same product at the same width. */
              className={clx(
                "h-0.5 w-8 transition-colors",
                i === index ? "bg-ui-fg-base" : "bg-ui-border-strong hover:bg-ui-fg-muted"
              )}
              data-testid="gallery-dot"
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageGallery
