"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import React from "react"

import { regionPath } from "@lib/util/product-url"

/**
 * A `<Link />` that keeps the current country code in the URL — EXCEPT for the default
 * region, which is served at the bare path.
 *
 * **This comment described `regionPath()` for two days while the code below still emitted
 * `/${countryCode}${href}` unconditionally**, with the flag it names imported and unused. So
 * every internal link on the site pointed into the prefixed shape; once the prefix started
 * redirecting away, every click would have cost a redirect hop. Doc and behaviour now come
 * from the same helper.
 *
 * YD is US-only, there is exactly one region, and the live site's URLs have no country
 * prefix. Emitting `/us/shop/tops` would mean every one of the 1,299 redirects in the map
 * lands on a URL that differs from the live one, taking two hops instead of one, while the
 * bare path — which is what every existing Google result and customer bookmark points at —
 * only ever redirected. On a migration whose entire purpose is preserving URL equity, that
 * is a self-inflicted cost. The middleware rewrites the bare path internally, so routing is
 * unchanged and the prefix can come back the day a second region exists.
 */
const LocalizedClientLink = ({
  children,
  href,
  ...props
}: {
  children?: React.ReactNode
  href: string
  className?: string
  onClick?: () => void
  passHref?: true
  [x: string]: any
}) => {
  const { countryCode } = useParams()
  return (
    <Link href={regionPath(String(countryCode), href)} {...props}>
      {children}
    </Link>
  )
}

export default LocalizedClientLink
