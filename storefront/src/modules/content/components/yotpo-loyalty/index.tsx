"use client"

import Script from "next/script"
import { useEffect, useState } from "react"

/**
 * The Yotpo loyalty widget, as embedded on the live site.
 *
 * This page cannot be extracted as copy: on the live site it is entirely client-rendered by
 * Yotpo, so the server HTML contains nothing to take. Yotpo stays through launch by standing
 * decision, and customers redeemed $10,891 through it in August alone — a blank page here is
 * not an option.
 *
 * The loader key and instance id are taken from the live page's own markup. They are public
 * site identifiers, not secrets — they ship in the HTML of every page on yogademocracy.com.
 *
 * Yotpo may refuse to render on an origin it does not recognise, and this preview is on
 * yd.thisisus.ai rather than yogademocracy.com. If it stays blank, that is a domain
 * allowlist entry in Yotpo's admin, not a bug here — which is why there is a visible
 * fallback rather than silent white space.
 */
const LOADER = "https://cdn-widgetsrepository.yotpo.com/v1/loader/gXbE7Q8YFrAtL7BMNomFrA"
const SDK = "https://cdn-loyalty.yotpo.com/loader/gXbE7Q8YFrAtL7BMNomFrA.js"

export default function YotpoLoyalty({ instanceId }: { instanceId: string }) {
  const [rendered, setRendered] = useState(true)

  useEffect(() => {
    // Give the widget time to mount, then say so plainly if it did not.
    const t = setTimeout(() => {
      const el = document.querySelector(
        `.yotpo-widget-instance[data-yotpo-instance-id="${instanceId}"]`
      )
      setRendered(!!el && el.childElementCount > 0)
    }, 6000)
    return () => clearTimeout(t)
  }, [instanceId])

  return (
    <div className="my-8">
      <Script src={LOADER} strategy="afterInteractive" />
      <Script src={SDK} strategy="afterInteractive" />
      <div className="yotpo-widget-instance" data-yotpo-instance-id={instanceId} />
      {!rendered && (
        <div className="border border-ui-border-base rounded-md p-6 text-ui-fg-subtle txt-medium">
          <p className="mb-2">
            The YD Rewards widget could not load on this preview domain.
          </p>
          <p className="txt-small">
            Yotpo restricts its widgets to approved domains, and this preview runs on
            yd.thisisus.ai. Add the domain in Yotpo, or view rewards on the live site. Your
            points and balance are unaffected — this is a display issue on the preview only.
          </p>
        </div>
      )}
    </div>
  )
}
