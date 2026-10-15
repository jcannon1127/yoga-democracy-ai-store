import Image from "next/image"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { readSiteChrome } from "@lib/content/site-chrome"
import ChevronDown from "@modules/common/icons/chevron-down"
import { STORE_NAME } from "@lib/constants/store"

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const chrome = readSiteChrome()
  const logo = chrome.logo

  return (
    <div className="w-full bg-white relative small:min-h-screen">
      <div className="h-16 bg-white border-b ">
        <nav className="flex h-full items-center content-container justify-between">
          <LocalizedClientLink
            href="/cart"
            className="text-small-semi text-ui-fg-base flex items-center gap-x-2 uppercase flex-1 basis-0"
            data-testid="back-to-cart-link"
          >
            <ChevronDown className="rotate-90" size={16} />
            <span className="mt-px hidden small:block txt-compact-plus text-ui-fg-subtle hover:text-ui-fg-base ">
              Back to shopping cart
            </span>
            <span className="mt-px block small:hidden txt-compact-plus text-ui-fg-subtle hover:text-ui-fg-base">
              Back
            </span>
          </LocalizedClientLink>
          <LocalizedClientLink
            href="/"
            className="flex items-center hover:opacity-80"
            data-testid="store-link"
          >
            {logo?.src ? (
              <Image
                src={logo.src}
                alt={logo.alt ?? STORE_NAME}
                width={logo.width ?? 110}
                height={logo.height ?? 110}
                className="h-10 w-10 object-contain"
              />
            ) : (
              <span className="txt-compact-xlarge-plus uppercase">{STORE_NAME}</span>
            )}
          </LocalizedClientLink>
          <div className="flex-1 basis-0" />
        </nav>
      </div>
      <div className="relative" data-testid="checkout-container">{children}</div>
    </div>
  )
}
