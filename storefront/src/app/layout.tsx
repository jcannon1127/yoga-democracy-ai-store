import { STORE_NAME } from "@lib/constants/store"
import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import "styles/globals.css"
import { SITE_IS_PUBLIC } from "@lib/constants/indexing"
import Analytics, {
  AnalyticsNoScript,
} from "@modules/common/components/analytics"

// PREVIEW HOST — NOT PUBLIC.
// yd.thisisus.ai serves YD's real catalog and real prices. An indexable duplicate of the
// catalogue a month before an SEO migration would compete with the live SFCC site for its
// own rankings, so every page is noindex here and there is a matching robots.txt disallow
// in src/app/robots.ts. Both, deliberately: a robots.txt disallow alone does NOT remove a
// URL Google already knows about — it only stops the crawl, and the URL can still be listed.
// Do not remove either until this becomes the real storefront on the real domain.
export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  // One place decides how every tab is labelled. Child pages set only their own name and
  // Next.js applies this template to any page that returns a plain string title.
  // A page whose title ALREADY ends in the store name must return { absolute } instead,
  // or it gets the suffix twice -- see metadataTitle() in @lib/constants/store.
  title: {
    default: STORE_NAME,
    template: `%s | ${STORE_NAME}`,
  },
  // Same switch as src/app/robots.ts, so the preview lock cannot be half-lifted.
  robots: SITE_IS_PUBLIC
    ? undefined
    : {
        index: false,
        follow: false,
        nocache: true,
        googleBot: { index: false, follow: false, noimageindex: true },
      },
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light">
      <body>
        <AnalyticsNoScript />
        <Analytics />
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
