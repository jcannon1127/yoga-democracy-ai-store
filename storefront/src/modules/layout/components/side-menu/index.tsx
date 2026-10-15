"use client"

import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Popover,
  PopoverPanel,
  Transition,
} from "@headlessui/react"
import { ArrowRightMini, XMark } from "@medusajs/icons"
import { Text, clx, useToggleState } from "@medusajs/ui"
import { Fragment } from "react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CountrySelect from "../country-select"
import LanguageSelect from "../language-select"
import { HttpTypes } from "@medusajs/types"
import { Locale } from "@lib/data/locales"
import { STORE_NAME } from "@lib/constants/store"

/**
 * The phone menu carries the same categories as the desktop nav.
 *
 * It used to list Home / Store / Account / Cart and nothing else, which meant every category
 * page — 64 of them — was unreachable from a phone: the dropdown nav above is `hidden
 * small:block`. Jeff reads this site on a phone, so "the categories exist" and "the categories
 * can be found" were two different things.
 *
 * Items come from site-chrome.json, so the phone menu and the desktop nav cannot drift apart,
 * and neither needs a deploy to change.
 */
type NavItem = {
  label: string
  href: string
  swatch?: string
  children?: NavItem[]
}

// Passed in from the server nav: a client component cannot read the content file, and
// importing it would freeze the menu into the bundle at build time.

const ACCOUNT_LINKS: NavItem[] = [
  { label: "Account", href: "/account" },
  { label: "Cart", href: "/cart" },
]

type SideMenuProps = {
  /**
   * Nav items, passed in from the server nav.
   *
   * A client component cannot read the content file, and importing it would freeze the
   * phone menu into the bundle at build time — the same trap that made "the merchandising team can change the
   * banner without a deploy" untrue for the rest of the chrome.
   */
  nav?: { label: string; href: string; children?: { label: string; href: string }[] }[]
  regions: HttpTypes.StoreRegion[] | null
  locales: Locale[] | null
  currentLocale: string | null
}

const SideMenu = ({ nav, regions, locales, currentLocale }: SideMenuProps) => {
  const countryToggleState = useToggleState()
  const languageToggleState = useToggleState()

  return (
    <div className="h-full">
      <div className="flex items-center h-full">
        <Popover className="h-full flex">
          {({ open, close }) => (
            <>
              <div className="relative flex h-full">
                <Popover.Button
                  data-testid="nav-menu-button"
                  aria-label="Menu"
                  className="relative h-full flex items-center justify-center min-h-[44px] min-w-[44px] transition-all ease-out duration-200 focus:outline-none hover:text-ui-fg-base"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                       stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
                  </svg>
                </Popover.Button>
              </div>

              {open && (
                <div
                  className="fixed inset-0 z-[50] bg-black/0 pointer-events-auto"
                  onClick={close}
                  data-testid="side-menu-backdrop"
                />
              )}

              <Transition
                show={open}
                as={Fragment}
                enter="transition ease-out duration-150"
                enterFrom="opacity-0"
                enterTo="opacity-100 backdrop-blur-2xl"
                leave="transition ease-in duration-150"
                leaveFrom="opacity-100 backdrop-blur-2xl"
                leaveTo="opacity-0"
              >
                <PopoverPanel className="flex flex-col absolute w-full pr-4 sm:pr-0 sm:w-1/3 2xl:w-1/4 sm:min-w-min h-[calc(100vh-1rem)] z-[51] inset-x-0 text-sm text-ui-fg-on-color m-2 backdrop-blur-2xl">
                  <div
                    data-testid="nav-menu-popup"
                    className="flex flex-col h-full bg-[rgba(3,7,18,0.5)] rounded-rounded justify-between p-6"
                  >
                    <div className="flex justify-end" id="xmark">
                      <button data-testid="close-menu-button" onClick={close}>
                        <XMark />
                      </button>
                    </div>
                    <ul className="flex flex-col gap-4 items-start justify-start overflow-y-auto flex-1 py-2">
                      {[...(nav ?? []), ...ACCOUNT_LINKS].map((item) => (
                        <li key={item.label} className="w-full">
                          {item.children?.length ? (
                            <Disclosure>
                              {({ open: sectionOpen }) => (
                                <>
                                  {/* The section header is a button, not a link: on a phone
                                      there is no hover, so tapping "Solids" has to open the
                                      list rather than navigate away from it. The section's own
                                      page is the first entry inside. */}
                                  <DisclosureButton className="flex items-center justify-between w-full min-h-[44px] text-2xl leading-9 hover:text-ui-fg-disabled">
                                    {item.label}
                                    <ArrowRightMini
                                      className={clx(
                                        "transition-transform duration-150",
                                        sectionOpen ? "rotate-90" : ""
                                      )}
                                    />
                                  </DisclosureButton>
                                  <DisclosurePanel as="ul" className="flex flex-col gap-2 pl-4 pt-2 pb-1">
                                    <li>
                                      <LocalizedClientLink
                                        href={item.href}
                                        className="flex items-center min-h-[44px] text-base leading-7 hover:text-ui-fg-disabled"
                                        onClick={close}
                                      >
                                        All {item.label}
                                      </LocalizedClientLink>
                                    </li>
                                    {item.children.map((child) => (
                                      <li key={child.label}>
                                        <LocalizedClientLink
                                          href={child.href}
                                          className="flex items-center gap-x-2 min-h-[44px] text-base leading-7 hover:text-ui-fg-disabled"
                                          onClick={close}
                                        >
                                          {child.swatch && (
                                            <span
                                              aria-hidden
                                              className="inline-block w-4 h-4 border border-white/30 shrink-0"
                                              style={{ backgroundColor: child.swatch }}
                                            />
                                          )}
                                          {child.label}
                                        </LocalizedClientLink>
                                      </li>
                                    ))}
                                  </DisclosurePanel>
                                </>
                              )}
                            </Disclosure>
                          ) : (
                            <LocalizedClientLink
                              href={item.href}
                              className="flex items-center min-h-[44px] text-2xl leading-9 hover:text-ui-fg-disabled"
                              onClick={close}
                              data-testid={`${item.label.toLowerCase().replace(/\s+/g, "-")}-link`}
                            >
                              {item.label}
                            </LocalizedClientLink>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-y-6">
                      {!!locales?.length && (
                        <div
                          className="flex justify-between"
                          onMouseEnter={languageToggleState.open}
                          onMouseLeave={languageToggleState.close}
                        >
                          <LanguageSelect
                            toggleState={languageToggleState}
                            locales={locales}
                            currentLocale={currentLocale}
                          />
                          <ArrowRightMini
                            className={clx(
                              "transition-transform duration-150",
                              languageToggleState.state ? "-rotate-90" : ""
                            )}
                          />
                        </div>
                      )}
                      <div
                        className="flex justify-between items-center min-h-[44px]"
                        onMouseEnter={countryToggleState.open}
                        onMouseLeave={countryToggleState.close}
                      >
                        {regions && (
                          <CountrySelect
                            toggleState={countryToggleState}
                            regions={regions}
                          />
                        )}
                        <ArrowRightMini
                          className={clx(
                            "transition-transform duration-150",
                            countryToggleState.state ? "-rotate-90" : ""
                          )}
                        />
                      </div>
                      <Text className="flex justify-between txt-compact-small">
                        © {new Date().getFullYear()} {STORE_NAME}. All rights
                        reserved.
                      </Text>
                    </div>
                  </div>
                </PopoverPanel>
              </Transition>
            </>
          )}
        </Popover>
      </div>
    </div>
  )
}

export default SideMenu
