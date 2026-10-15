import Script from "next/script"

import { readSiteChrome } from "@lib/content/site-chrome"
import { SITE_IS_PUBLIC } from "@lib/constants/indexing"

/**
 * The measurement stack, matched to the live site rather than invented.
 *
 * Read from live's own page source and its GTM container on 2026-08-26, which is the only way
 * to see the shape of it:
 *
 *     GTM-THH3C3W            Google Tag Manager -- the container
 *       └ G-70YFKZMYB4       GA4, INSIDE the container, not on the page
 *       └ fbevents.js        Meta, INSIDE the container, not on the page
 *     AW-970394304           Google Ads conversion, inline on the page
 *     bViWbF                 Klaviyo onsite
 *     D3RAJRRC77U6ID07LMBG   TikTok pixel, inline via ttq.load()
 *
 * **So this ships GTM, Klaviyo and TikTok, and NOT GA4 or Meta.** Those fire from inside the
 * container. Adding them here as well would double-count every pageview and every conversion,
 * which is worse than having none: a launch you cannot measure is a problem, and a launch whose
 * numbers are quietly twice reality is a decision made on a wrong number.
 *
 * NOT COPIED FROM LIVE, deliberately:
 *   - `cdn.cquotient.com` and `cdn.c360a.salesforce.com` — SFCC's own Einstein/CDP. They die
 *     with the platform and mean nothing on this stack.
 *   - `h.online-metrix.net` — ThreatMetrix, which belongs to a payment provider, not to YD.
 *
 * EVERY ID IS EMPTY BY DEFAULT AND THIS RENDERS NOTHING.
 *
 * The ids are public — they are in live's HTML — but WHICH of them YD wants pointed at the new
 * site is a decision nobody has made yet: reuse the live container and have both sites report
 * into one property (continuity), or take a fresh one (a clean before/after). That is Jeff's or
 * Jay's call, so the code waits with a blank in it rather than guessing, and turning it on is a
 * line of JSON.
 *
 * It is also gated on SITE_IS_PUBLIC, the same switch that holds the noindex: firing analytics
 * from a private preview would pollute whichever property it points at with traffic that is
 * entirely us.
 */
type AnalyticsConfig = {
  gtm_container_id?: string
  klaviyo_company_id?: string
  tiktok_pixel_id?: string
}

export function analyticsConfig(): AnalyticsConfig {
  return ((readSiteChrome() as any)?.analytics ?? {}) as AnalyticsConfig
}

const Analytics = () => {
  if (!SITE_IS_PUBLIC) {
    return null
  }

  const { gtm_container_id, klaviyo_company_id, tiktok_pixel_id } = analyticsConfig()

  return (
    <>
      {gtm_container_id && (
        <Script id="gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtm_container_id}');`}
        </Script>
      )}

      {klaviyo_company_id && (
        <Script
          id="klaviyo"
          strategy="afterInteractive"
          src={`https://static.klaviyo.com/onsite/js/${klaviyo_company_id}/klaviyo.js`}
        />
      )}

      {tiktok_pixel_id && (
        <Script id="tiktok" strategy="afterInteractive">
          {`!function (w, d, t) { w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";
ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;
ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";
o.async=!0;o.src=r+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];
a.parentNode.insertBefore(o,a)};
ttq.load('${tiktok_pixel_id}');ttq.page();}(window, document, 'ttq');`}
        </Script>
      )}
    </>
  )
}

/**
 * GTM's `<noscript>` half. Separate because it belongs in the body, not the head, and because
 * a container with no noscript fallback silently drops every visitor with JS disabled — a small
 * population, but one that is invisible rather than absent from the numbers.
 */
export const AnalyticsNoScript = () => {
  if (!SITE_IS_PUBLIC) {
    return null
  }
  const { gtm_container_id } = analyticsConfig()
  if (!gtm_container_id) {
    return null
  }
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${gtm_container_id}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
      />
    </noscript>
  )
}

export default Analytics
