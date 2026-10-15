"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { Button } from "@medusajs/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type Slide = {
  alt: string
  href: string
  desktop: string
  mobile?: string
  cta?: { label: string; href: string }
}

/**
 * Rotating hero, matching the live site's three-slide carousel.
 *
 * Written by hand rather than pulling in Swiper (the library the live site uses): three
 * slides, arrows and auto-advance do not justify a dependency, and every package added here
 * is one more thing to keep working through a migration.
 *
 * Slides come from site-chrome.json so the merchandising team can add, remove or reorder a time-limited
 * marketing creative without a deploy.
 *
 * Accessibility and restraint: auto-advance stops on hover and on focus, and never restarts
 * against the visitor. Every slide is a real link, so the carousel still works with no JS —
 * the first slide renders as a plain linked image.
 */
export default function HeroCarousel({
  slides,
  autoplayMs = 6000,
}: {
  slides: Slide[]
  autoplayMs?: number
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const go = useCallback(
    (next: number) => setIndex((next + slides.length) % slides.length),
    [slides.length]
  )

  useEffect(() => {
    if (paused || slides.length < 2) return
    const t = setTimeout(() => go(index + 1), autoplayMs)
    return () => clearTimeout(t)
  }, [index, paused, autoplayMs, go, slides.length])

  if (!slides.length) return null

  return (
    <div
      className="relative w-full border-b border-ui-border-base overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      aria-roledescription="carousel"
      aria-label="Featured"
    >
      {slides.map((slide, i) => (
        <div
          key={slide.desktop}
          className={i === index ? "block" : "hidden"}
          aria-hidden={i !== index}
        >
          <LocalizedClientLink href={slide.href} className="block">
            <Image
              src={slide.desktop}
              alt={slide.alt}
              width={2000}
              height={814}
              priority={i === 0}
              // Never larger than the source: the artwork is 2000px wide and "100vw" made
              // Next generate an upscaled 3840px PNG on demand — a blank hero while it
              // rendered, which is what a first visit actually looked like.
              sizes="(max-width: 2000px) 100vw, 2000px"
              className="hidden small:block w-full h-auto"
            />
            <Image
              src={slide.mobile ?? slide.desktop}
              alt={slide.alt}
              width={800}
              height={800}
              priority={i === 0}
              sizes="(max-width: 800px) 100vw, 800px"
              className="small:hidden w-full h-auto"
            />
          </LocalizedClientLink>

          {slide.cta?.label && (
            <div className="absolute inset-x-0 bottom-14 small:bottom-16 flex justify-center">
              <LocalizedClientLink href={slide.cta.href}>
                <Button variant="primary" className="h-11 px-8 shadow-lg">
                  {slide.cta.label}
                </Button>
              </LocalizedClientLink>
            </div>
          )}
        </div>
      ))}

      {slides.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="absolute left-2 small:left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full w-9 h-9 flex items-center justify-center shadow"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="absolute right-2 small:right-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full w-9 h-9 flex items-center justify-center shadow"
          >
            <span aria-hidden="true">›</span>
          </button>

          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
            {slides.map((slide, i) => (
              <button
                key={`dot-${slide.desktop}`}
                type="button"
                onClick={() => go(i)}
                aria-label={`Go to slide ${i + 1}: ${slide.alt}`}
                aria-current={i === index}
                className={`w-2 h-2 rounded-full ring-1 ring-black/20 ${
                  i === index ? "bg-yd-primary" : "bg-white/80"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
