# Vendored: CyberSource payment provider for Medusa v2

**Upstream:** [Eleven-Estudio/medusa-payment-cybersource](https://github.com/Eleven-Estudio/medusa-payment-cybersource)
v1.1.1, MIT. Vendored from source 2026-08-22 at 1,347 lines.

## Why this is vendored rather than an npm dependency

The package is competently written but **unmaintained** — last commit 2026-03-13, four GitHub
stars, zero issues ever filed, ~122 downloads/month, and it targets `@medusajs/framework` 2.10
while YD runs 2.19. Depending on a stranger's release cadence for the payment path is the wrong
risk. At this size we can read every line and own it, which is the safer of the two options, not
the more expensive one.

Upstream is MIT; `LICENSE` is preserved and attribution stays.

## What upstream does well

Full `AbstractPaymentProvider` implementation on **Flex Microform v2**, so the card number never
touches our server (PCI SAQ-A). Authorization with manual or auto capture, void, partial refunds,
ThreatMetrix device fingerprinting, zero-amount orders short-circuited without a gateway call,
and an admin widget on the order page.

## What it does NOT do, that YD needs

1. **No vault / Token Management.** It only handles one-shot Flex transient tokens. YD's live
   SFCC checkout offers saved cards with a CVV re-prompt; matching that means building TMS
   support. CyberSource TMS is provisioned and working on YD's sandbox — verified 2026-08-20 —
   so this is ours to build, not a gateway limitation.
2. **No 3-D Secure / payer authentication.** Acceptable for US card-not-present, but it means no
   fraud liability shift, and it is a hard blocker for EU/UK customers where SCA is mandatory.
3. **Non-standard checkout coupling.** The storefront must call `POST /store/cybersource/authorize`
   *before* `placeOrder()`. Anyone building checkout has to know this; it is not how a stock
   Medusa payment provider behaves.
4. **Deprecating auth scheme.** It authenticates with HTTP Signature, which CyberSource has
   marked as deprecating in favour of JWT. The same shared-secret key pair serves both, so this
   is not urgent — but it is on the list.
5. **No tests.**

## House rules for this fork

Per `docs/payments-config.md`: credentials and provider id come from config, never literals;
sandbox vs production is a config flag, not a branch; auto-capture, allowed card networks and
3DS on/off are config, not constants.

## Local changes

### 1. APPLIED 2026-08-22 — fix `targetOrigins`, which broke every payment session
`resolveTargetOrigins()` in `providers/cybersource.ts`, replacing two duplicated inline filters.

Upstream's allowlist accepted `http://127.0.0.1`. **CyberSource does not** — it rejects any
`http://` origin unless the host is exactly `localhost`:
`"Target Origin[0] cannot use http protocol unless the host is localhost"`. It validates **every**
origin, not just the first, so a single bad entry fails the whole call.

YD's `STORE_CORS` is `http://127.0.0.1:8000,http://localhost:8000`, so upstream sent the rejected
form and **every `initiatePayment` returned HTTP 500**. Found by driving a real cart through the
registered provider, not by reading code — the provider loaded and registered cleanly and still
failed on first use.

Proven against the sandbox before and after:

| targetOrigins | CyberSource |
|---|---|
| `http://127.0.0.1:8000` | **400** |
| `http://localhost:8000` | 201 |
| both, either order | **400** |
| `https://yogademocracy.com` | 201 |

The helper is also the tenancy-rule shape: origins come from config, with no hostname anywhere in
logic. Production needs `STORE_CORS` to carry the real `https://` origin — which is fine, since
`https://` is accepted unconditionally.

### 2. APPLIED 2026-08-23 — Apple Pay and Google Pay authorization path
`authorizeWallet()` in `client/cybersource-client.ts`, plus wallet handling in the store
authorize route. Upstream had **no wallet path at all**.

Wallets are the same merchant, money flow, capture, void, refund and reconciliation as a card —
they differ only in how the instrument arrives: an encrypted wallet payload in
`paymentInformation.fluidData.value` rather than a Flex transient token, discriminated by
`processingInformation.paymentSolution` (`001` Apple, `012` Google). Apple additionally requires
`fluidData.descriptor` = base64 of `FID=COMMON.APPLE.INAPP.PAYMENT` (decoded to check, not copied
on faith). YD never decrypts the payload, so no Apple payment-processing certificate is held.

Shared request scaffolding was factored into `buildAuthRequest()` deliberately: the duplicated
`targetOrigins` filters in this package drifted and broke every payment session, and two copies of
a request builder would drift the same way.

**Verified 14/14 by `wallet-request.test.js`**, which intercepts the SDK and asserts the request
shape — paymentSolution, payload placement, descriptor, fingerprint and billTo preserved, and the
**card path provably unchanged**. It cannot verify the gateway accepts it; nothing can until a
processor is attached.

**Queued, highest first:**
1. **Fix the fraud-review mapping.** `AUTHORIZED_PENDING_REVIEW` → `requires_more` means a
   Decision-Manager-held order likely never completes: authorization succeeds at the gateway and
   no order is created in Medusa. Should map to `authorized` with the review state surfaced in
   admin, and capture withheld. See `docs/checkout-requirements.md`. Not yet reproduced — the
   sandbox cannot process payments.
2. **Add TMS / vault support** for saved cards, which upstream does not have.
3. **Partial gift-certificate tender** — gateway is authorized for the remainder only.

## Known environment blocker

YD's sandbox merchant is **not provisioned for transaction processing**: `POST /pts/v2/payments`
returns 404 while Microform, TMS and Transaction Search all return 201. Until the owner or tech lead
attaches a test processor in the test Business Center, this provider can tokenize a card but
cannot complete a purchase. Run `scripts/cs_service_probe.py` to check current status.
