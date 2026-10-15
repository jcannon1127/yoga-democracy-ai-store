# Preview storefront — yd.thisisus.ai

Medusa's official Next.js starter (`medusajs/nextjs-starter-medusa`, v2), pointed at the
Medusa prototype on the Spark. Owned by **yd-store**. The edge (nginx, cookie gate, TLS)
is **the operations agent's** and is not configured from here. `medusa-proto/` is **the catalogue agent's**.

## Run

    cd ~/yd-worktrees/yd-store/storefront
    npm run dev        # 127.0.0.1:8000

Needs `medusa.service` up on 127.0.0.1:9000 and a publishable key in `.env.local`.

## Single origin — why there is no CORS config here

    https://yd.thisisus.ai/static/*  -> 127.0.0.1:9000
    https://yd.thisisus.ai/store/*   -> 127.0.0.1:9000
    https://yd.thisisus.ai/*         -> 127.0.0.1:8000  (this app)

The browser only ever talks to one origin, so there is nothing to allow.

`MEDUSA_BACKEND_URL=http://127.0.0.1:9000` is **server-side only** — no client component
imports the SDK (verified), so that value is never shipped to a browser. It is not the
"localhost:9000 baked into stored data" bug the catalogue agent is fixing; that one is absolute
localhost URLs rendered *into* the page, which a visitor's browser cannot resolve.

## noindex is a requirement, not a default

This host serves YD's real catalog and real prices, a month before an SEO migration. An
indexable duplicate would compete with the live SFCC site for its own rankings.

1. `src/app/layout.tsx` — `robots: { index: false, follow: false }` at the **root** layout,
   so no page can opt out.
2. `src/app/robots.ts` — `Disallow: /` for all agents.

Both, deliberately: a robots.txt disallow alone does **not** remove a URL Google already
knows about; it stops the crawl while the URL can still be listed. The meta tag is what
actually keeps it out, and the crawler has to be allowed in to read it.

`next-sitemap.js` was **deleted** — it shipped a generated `robots.txt` with `allow: /`,
which would have silently overwritten the disallow above the moment anyone ran a postbuild.

## Not in scope

Checkout is **yd-pay's** surface. The starter ships a Stripe-flavoured checkout flow; it is
left inert and no payment provider is wired. Do not "finish" it here.

## Stock is three-state, on purpose

`inventory_quantity: null` is not zero. It means the SKU was absent from the fulfillment
feed, so nothing is tracked — 97 of 558 variants. "We don't know" and "we have none" are
different facts, and the starter collapsed them in both directions: unmanaged variants were
treated as freely buyable, while `(inventory_quantity || 0)` turns null into a hard "Out of
stock". `src/lib/util/availability.ts` returns `in-stock | out-of-stock | unknown`, and
unknown says so on the page rather than guessing.

Two starter bugs fixed while wiring it up:

- **`?v_id=` was written but never read.** The component pushes the selected variant into the
  URL on every click and then ignores it on load, so a shared link to a specific size arrived
  with nothing selected.
- **"Out of stock" was shown before you picked a size.** The guard was
  `!selectedVariant && !options` — `options` starts as `{}`, which is truthy, so `!options`
  is always false and the branch never fired. It now says "Select size".

Verified: `node` table test over the six cases (see git history) — null is never rendered as
zero. The `?v_id=` preselect is a client-side effect and could not be verified by curl; it
needs a browser, and there is no headless browser on the Spark.

## Store name lives in one place

`src/lib/constants/store.ts` exports `STORE_NAME` (overridable with `NEXT_PUBLIC_STORE_NAME`).
The starter hardcoded "Medusa Store" in 15 spots across 10 files — the kind of string that
gets 14 of 15 updated, and it surfaces in tab titles, link previews and later in email.

Page titles are **not** suffixed per page. The root layout sets a `title.template` of
`%s | Yoga Democracy`, so each page supplies only its own name and no page can drift or
double-suffix. The starter did double-suffix: category pages rendered
`Tops | Medusa Store | Medusa Store`, because the name was appended once when building
`title` and again when returning it.

## Homepage

The starter's homepage is a hero reading "Ecommerce Starter Template / Powered by Medusa and
Next.js" with **View on GitHub** as its only call to action, plus `FeaturedProducts`, which
lists *collections* — and this catalog has none, so the front door showed no products at all.
Jeff's reaction on first opening the preview: "it doesn't look like a website, it just lets
you click to GitHub."

Now: a hero with the YD name and a Shop button, then a 12-product grid
(`src/modules/home/components/featured-grid/`). The grid skips products with no thumbnail
rather than rendering grey boxes — image coverage is 94%, so a plain `limit: 12` puts a
placeholder in the shop window. It over-fetches and slices to keep the grid full.

## The /static rewrite — do not remove it

`next.config.js` rewrites `/static/*` to the Medusa backend. This is not redundant with the
edge, and every product image is broken without it.

Medusa stores image URLs **relative** (`/static/foo.jpg`), which is correct — absolute URLs
would bake today's hostname into the database. A browser resolves them fine, because the edge
proxies `/static/*` to Medusa. But **next/image's optimizer runs on the Next server** and
resolves a relative src against its *own* origin — `:8000/static/...`, which does not exist.
It was being handed Next's own 404 HTML page, and logging:

    The requested resource isn't a valid image for /static/… received text/html

The rewrite gives the Next server the same view of `/static` the browser has. Verified:
optimizer returns `200 image/jpeg`, 162KB original served as 57KB at w=640.

## The six products with no photography

`thumbnail IS NULL` on 6 of 100. They are discontinued or seasonal, with no live SFCC page
left to harvest an image from, so they stay blank until someone shoots them. Two were landing
in the first row of the store listing, where an empty tile reads as "the site is broken".

They are **sorted to the end, not filtered out** (`src/lib/util/sort-products.ts`). The
preview should show all 100 and be honest that six lack photography, rather than quietly
show 94 and imply that is the catalog. The sort is stable, so the shopper's chosen sort still
orders everything within each group, and it runs before pagination — so the blanks land on
the last page rather than at the foot of every page.

Verified: page 1 has no blanks, all six sit in the final six slots, all 100 still reachable.
The homepage grid handles this separately by skipping thumbnail-less products outright.

## Why a sales-channel misconfiguration must not take the shop down

Medusa can only answer "how many are in stock" when the publishable key resolves to exactly
**one** sales channel. If it resolves to several, it rejects the entire `/store/products`
request with a 400 — so prices, images and titles die along with the stock figure. This has
caused two outages, and the symptom looks nothing like the cause: product pages return 500
and the listing renders "Page not found".

`listProducts` now catches that specific error and retries without the inventory field. The
catalogue keeps serving and every variant shows **availability unknown**, which is honest —
we genuinely do not know. The underlying fix is still to link the key to one sales channel;
this only stops a config mistake from becoming a dead storefront.

Note it is deliberately narrow: the retry only triggers on `/single sales channel/i`. Any
other error still throws, because silently swallowing failures is how a shop ends up serving
an empty catalogue and reporting success.

## Extracted content vs authored content

`src/content/pages/<slug>.json` is **generated** — re-running the extractor overwrites it
wholesale. Anything we add that the live site does not have goes in
`src/content/pages/<slug>.additions.json`, which the route appends. This is not tidiness:
re-extracting once silently deleted an approved section (the DIY hemming video on Free
Hemming) and the page still rendered fine, so nothing looked wrong.

Two extractor bugs worth remembering, both of which produced a *plausible* result rather
than an error:

- **Media nested inside a paragraph was swallowed.** The `<p>…</p>` match is non-greedy but
  DOTALL, so an `<img>` inside a paragraph disappeared into the text block. The Indianapolis
  Store page extracted "successfully" with 0 images while its hero sat inside a `<p>`.
  Tables had the same problem, which is why both are stashed as placeholders before the text
  pass — and the placeholders are now expanded *inside* text blocks too.
- **Content images live in a different SFCC library** (`Sites-yoga-democracy-b2c-Library`)
  from product photography (`Sites-yd-products`), and some are referenced from the **staging**
  host. We rewrite `stg.` to `www.`.

## It runs as a systemd unit, on a production build

    sudo systemctl status yd-storefront      # unit file mirrored at deploy-yd-storefront.service
    npm run build && sudo systemctl restart yd-storefront

**Never serve the preview from `next dev`.** Dev shows visitors Next's red runtime-error
overlay with a call stack instead of a website — Jeff hit exactly that — and it is markedly
slower. `next start` refuses to run without a build, which is the behaviour we want.

Deploying means a short outage: `next build` rewrites `.next` underneath the running server,
so a build and the server cannot safely share it. Announce the window, then build and restart.

**Do not stop the server with `pkill -f "next dev"`.** The pattern matches the shell running
that very command, so the command kills itself before doing anything after it — that is how
the preview ended up down with nothing replacing it. Use `systemctl`, or resolve PIDs first.

## The store listing must page through the whole catalogue

`listProductsWithSort` used to fetch a fixed `limit: 100` and slice *that* window into every
page. Correct at 100 products, silently wrong at 552: page 9 was the last with anything on
it and **452 products could not be reached from the store at all**. Nothing errored. It now
walks the API in pages of 100 up to `count` (guarded at 5,000) before sorting, because price
sorting happens client-side and needs the full set. Verified: page 46 is full, page 47 empty,
which is exactly 552 products at 12 a page.

## Next.js is pinned at 15.3.9 and its own overlay calls it outdated

Not urgent, and not something to change while the preview is the thing being demoed — but it
is written down here so it stops being rediscovered.
