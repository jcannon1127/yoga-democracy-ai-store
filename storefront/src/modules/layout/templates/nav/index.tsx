import { Suspense } from "react"

import { listRegions } from "@lib/data/regions"
import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"
import { STORE_NAME } from "@lib/constants/store"
import Image from "next/image"
import { readSiteChrome } from "@lib/content/site-chrome"
import SocialLinks from "@modules/layout/components/social-links"
import SearchBox from "@modules/search/components/search-box"

export default async function Nav() {
  const chrome = readSiteChrome()
  const [regions, locales, currentLocale] = await Promise.all([
    listRegions().then((regions: StoreRegion[]) => regions),
    listLocales(),
    getLocale(),
  ])

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      {chrome.announcement?.text && (
        <div className="relative w-full bg-yd-primary text-white">
          {/* Social icons live INSIDE the green bar on the live site, left-aligned, with the
              announcement centred across the full width rather than beside them. */}
          <SocialLinks className="hidden min-[768px]:flex absolute left-6 inset-y-0 items-center gap-x-3" />
          <LocalizedClientLink
            href={chrome.announcement.href || "/store"}
            className="block w-full text-center txt-compact-small py-2 px-4 hover:opacity-90"
            data-testid="announcement-bar"
          >
            {chrome.announcement.text}
          </LocalizedClientLink>
        </div>
      )}
      <header className="relative h-16 mx-auto border-b duration-200 bg-white border-ui-border-base">
        <nav className="content-container txt-xsmall-plus text-ui-fg-subtle flex items-center justify-between w-full h-full text-small-regular">
          <div className="flex-1 basis-0 h-full flex items-center gap-x-4">
            {/* Phone only, matching live, since 2026-08-25.
                It was kept at desktop widths because it was the only home for the country
                and locale switchers. With the /us/ prefix dropped there is one region and
                no locales endpoint, so on desktop it held nothing the header and nav bar do
                not already show. Below 768 it is still the ONLY way to reach the 64
                category pages -- the nav bar is `hidden min-[768px]:block`. */}
            <div className="h-full min-[768px]:hidden">
              <SideMenu nav={chrome.nav} regions={regions} locales={locales} currentLocale={currentLocale} />
            </div>
            {/* Live spends 72px here on an icon and the word "Search" that goes to the search
                page. Ours was a 294px input plus an 82px filled button, which is most of why
                the header read as heavier than the live one. */}
            {chrome.utility?.show_search && (
              <LocalizedClientLink
                href="/search"
                className="hidden min-[768px]:flex items-center gap-x-2 min-h-[44px] hover:text-ui-fg-base"
                data-testid="nav-search-desktop"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
                Search
              </LocalizedClientLink>
            )}
          </div>

          <div className="flex items-center h-full">
            <LocalizedClientLink
              href="/"
              className="flex items-center hover:opacity-80"
              data-testid="nav-store-link"
            >
              <Image
                src={chrome.logo.src}
                alt={chrome.logo.alt ?? STORE_NAME}
                width={chrome.logo.width}
                height={chrome.logo.height}
                priority
                className="h-14 w-14 object-contain"
              />
            </LocalizedClientLink>
          </div>

          <div className="flex items-center gap-x-6 h-full flex-1 basis-0 justify-end">
            {/* Search: an icon on phones (the input needs room the header does not have),
                the full box from `small` up. It goes to the real /search page either way. */}
            {chrome.utility?.show_search && (
              <LocalizedClientLink
                className="min-[768px]:hidden hover:text-ui-fg-base flex items-center justify-center min-h-[44px] min-w-[44px]"
                href="/search"
                aria-label="Search"
                data-testid="nav-search-link"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
              </LocalizedClientLink>
            )}

            <LocalizedClientLink
              className="hover:text-ui-fg-base flex items-center justify-center min-h-[44px] min-[768px]:min-w-0 min-w-[44px]"
              href="/account"
              aria-label="Account"
              data-testid="nav-account-link"
            >
              <span className="hidden min-[768px]:inline">Account</span>
              <svg className="min-[768px]:hidden" viewBox="0 0 24 24" width="20" height="20"
                   fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" strokeLinecap="round" />
              </svg>
            </LocalizedClientLink>
            <Suspense
              fallback={
<LocalizedClientLink
            className="hover:text-ui-fg-base min-h-[44px] min-w-[44px] flex items-center justify-center relative"
            href="/cart"
            aria-label={`Cart (0)`}
            data-testid="nav-cart-link"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                 stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M6 7h12l-1 12H7L6 7z" strokeLinejoin="round" />
              <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
            </svg>
            {/* The count rides the icon as a badge, as it does on the live site. Always
                rendered, including at 0, so the element does not appear and disappear. */}
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full
                         bg-yd-primary text-white text-[11px] leading-[18px] text-center"
              data-testid="nav-cart-count"
            >
              0
            </span>
          </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
          </div>
        </nav>
      </header>
      {chrome.nav?.length > 0 && (
        <nav className="hidden min-[768px]:block w-full bg-white border-b border-ui-border-base">
          <ul className="content-container flex items-center justify-center gap-x-8 h-11 txt-compact-small uppercase tracking-wide">
            {chrome.nav.map((item) => {
              // The live header drops a menu under Collections, Solids and Shop. CSS only —
              // hover and focus-within — so the nav stays a server component and works with
              // JavaScript still loading. Items with no children render exactly as before.
              const children = (item as {
                children?: { label: string; href: string; swatch?: string }[]
              }).children

              return (
                <li key={item.label} className="relative group/nav">
                  <LocalizedClientLink
                    href={item.href}
                    className="text-ui-fg-subtle hover:text-ui-fg-base inline-flex items-center h-11"
                  >
                    {item.label}
                  </LocalizedClientLink>
                  {children?.length ? (
                    <ul
                      className="absolute left-1/2 -translate-x-1/2 top-full z-50 hidden group-hover/nav:block group-focus-within/nav:block bg-white border border-ui-border-base min-w-48 py-2 shadow-elevation-card-rest normal-case tracking-normal"
                      data-testid={`nav-menu-${item.label}`}
                    >
                      {children.map((child) => (
                        <li key={child.label}>
                          <LocalizedClientLink
                            href={child.href}
                            className="flex items-center gap-x-2 px-4 py-1.5 whitespace-nowrap text-ui-fg-subtle hover:text-ui-fg-base hover:bg-ui-bg-subtle"
                          >
                            {/* The colour block the live nav shows beside each solid. The hex
                                comes from site-chrome.json and exists in no other system —
                                it was only ever on the live site. */}
                            {child.swatch && (
                              <span
                                aria-hidden
                                className="inline-block w-4 h-4 border border-ui-border-base shrink-0"
                                style={{ backgroundColor: child.swatch }}
                              />
                            )}
                            {child.label}
                          </LocalizedClientLink>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </div>
  )
}
