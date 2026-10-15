# Build provenance — CyberSource payment provider (YD fork)

**Built from:** branch `yd-pay`, commit `0efe7ee1ae01626b4a78b13e5fbd8bd0e36151e6`
**Built on:** 2026-08-22, against Medusa **2.19.0**
**Source of truth:** `payments/cybersource-provider/` on branch `yd-pay`. **This directory is a
build artifact — never edit it in place.** Edits here are lost on the next build and, worse,
make the source and the running code disagree silently.

## Upstream

Eleven-Estudio/medusa-payment-cybersource v1.1.1, MIT. LICENSE preserved.
Version marked `1.1.1-yd.1`, `private: true`, so it can never shadow upstream if published.

## Local changes in this build

1. **`resolveTargetOrigins()` — fixes a bug that broke every payment session on YD's config.**
   CyberSource rejects `http://` target origins unless the host is exactly `localhost`.
   Upstream also allowed `http://127.0.0.1`, which is what YD's `STORE_CORS` supplies, so
   `initiatePayment` returned HTTP 500 every time. Verified against the sandbox:
   `127.0.0.1` → 400, `localhost` → 201, both together → 400 **in either order** (it validates
   every origin, not just the first), `https://` → 201.
   Also de-duplicates two inline filters that had to stay in sync.
2. **devDependencies aligned to Medusa 2.19.0.** Upstream's were internally inconsistent
   (`@medusajs/framework` 2.10.3 against a `^2.13.1` CLI) and `npm install` failed outright.
   Fixed properly rather than with `--legacy-peer-deps`.

**Compatibility result worth recording:** the 2.10-era source **type-checks against 2.19 with no
errors**, and the admin widget builds.

## Drift detection

If yd-pay reports a fix and the commit above is unchanged, **one of us is wrong** — either the
build was not refreshed or the fix did not land. Check this hash first, before debugging behaviour.

## What this does NOT mean

The provider working is not a working checkout. As of this build the merchant is **not
provisioned for transaction processing** (`POST /pts/v2/payments` → 404) and **tokenization is
unverified**. A capture context returning 201 moves neither.
