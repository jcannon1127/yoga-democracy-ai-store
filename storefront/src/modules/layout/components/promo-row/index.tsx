import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { readSiteChrome } from "@lib/content/site-chrome"

/**
 * The three tiles the live site shows above the footer on every page.
 *
 * Captions are verbatim from the live markup. A tile with no `href` renders as plain text
 * rather than a link — Gift Cards is a real feature on the live site (`/giftcard`) that has
 * no equivalent here yet, and a tile that looks clickable and goes nowhere (or worse, goes
 * somewhere that is not gift cards) is a dead control.
 */
const ICONS: Record<string, string> = {
  // Simple line icons rather than a font dependency for three glyphs.
  truck: "M3 7h11v8H3zM14 10h3.5l2.5 3v2h-6zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm10 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  gift: "M20 8h-2.2a3 3 0 00-4.3-4L12 5.2 10.5 4A3 3 0 006.2 8H4v4h1v8h14v-8h1zm-6.5-2.6a1 1 0 111.4 1.4L13 8.4V6.6zM9.1 5.4a1 1 0 011.4 0L11 6.6v1.8L9.1 6.8a1 1 0 010-1.4zM11 20H7v-6h4zm6 0h-4v-6h4zM11 12H6v-2h5zm7 0h-5v-2h5z",
}

export default function PromoRow() {
  const chrome = readSiteChrome()
  const promos = chrome.promos ?? []
  if (!promos.length) return null

  return (
    <div className="w-full border-t border-ui-border-base bg-ui-bg-subtle">
      <ul className="content-container grid grid-cols-1 small:grid-cols-3 gap-6 py-10 text-center">
        {promos.map((promo) => {
          const body = (
            <span className="flex flex-col items-center gap-y-2 text-ui-fg-subtle">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                <path d={ICONS[promo.icon] ?? ICONS.gift} />
              </svg>
              <span className="txt-compact-medium">{promo.caption}</span>
            </span>
          )
          return (
            <li key={promo.caption}>
              {promo.href ? (
                <LocalizedClientLink href={promo.href} className="hover:text-ui-fg-base block">
                  {body}
                </LocalizedClientLink>
              ) : (
                body
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
