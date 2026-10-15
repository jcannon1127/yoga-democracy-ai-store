"use client"

import Script from "next/script"

import { YOTPO_APP_KEY } from "./yotpo-attrs"

/**
 * Loads Yotpo's widget script once per page.
 *
 * `lazyOnload` on purpose: reviews sit below the fold, and the script is third-party and
 * heavy. Blocking the buy box on a vendor bundle would trade the thing that sells for the
 * thing that reassures. Next dedupes by `id`, so both widgets can mount this safely.
 *
 * Renders nothing without an app key, which is the state today — the key belongs in the
 * environment, from whoever owns the Yotpo account.
 */
const YotpoScript = () => {
  if (!YOTPO_APP_KEY) {
    return null
  }

  return (
    <Script
      id="yotpo-widget"
      strategy="lazyOnload"
      src={`https://staticw2.yotpo.com/${YOTPO_APP_KEY}/widget.js`}
    />
  )
}

export default YotpoScript
