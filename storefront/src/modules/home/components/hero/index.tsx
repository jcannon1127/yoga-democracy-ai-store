import { Button, Heading } from "@medusajs/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { STORE_NAME } from "@lib/constants/store"
import { readSiteChrome } from "@lib/content/site-chrome"
import HeroCarousel from "./carousel"

/**
 * Full-bleed hero.
 *
 * Slides are content (`site-chrome.json`), not files baked into this component — they are
 * time-limited marketing creatives and the merchandising team changes them without a deploy. Falls back to the
 * wordmark when the slide list is emptied, so removing a campaign leaves the page plain
 * rather than broken.
 */
const Hero = () => {
  const chrome = readSiteChrome()
  const slides = chrome.hero_slides ?? []

  if (slides.length) {
    return (
      <HeroCarousel slides={slides} autoplayMs={chrome.hero_autoplay_ms ?? 6000} />
    )
  }

  return (
    <div className="h-[60vh] w-full border-b border-ui-border-base relative bg-ui-bg-subtle">
      <div className="absolute inset-0 z-10 flex flex-col justify-center items-center text-center gap-6">
        <Heading level="h1" className="text-4xl text-ui-fg-base font-normal">
          {STORE_NAME}
        </Heading>
        <LocalizedClientLink href="/store">
          <Button variant="primary" className="h-10 px-6">Shop the collection</Button>
        </LocalizedClientLink>
      </div>
    </div>
  )
}

export default Hero
