# Vendored: PayPal payment provider for Medusa v2

**Upstream:** [alphabite-dev/medusa-paypal](https://github.com/alphabite-dev/medusa-paypal)
`@alphabite/medusa-paypal` 0.2.6. Vendored from source 2026-08-24, ~1,074 lines.

**Licence, stated accurately:** `package.json` declares **MIT**, and npm lists it as MIT. But
**the repository contains no LICENSE file** — fetching one returns 404, and GitHub's licence
detection finds none. So the declaration is real but unfiled. That is almost certainly an
oversight rather than a restriction, and MIT in `package.json` is the author's stated intent. It
is recorded here because vendoring someone's code on a declared-but-unfiled licence is worth
knowing, not worth hiding. If YD ever needs this to be watertight, ask the author to add the file.

## Why vendored from THIS source

`@jenisn/medusa-paypal` 2.0.1 is a republish of this code with a looser peer range and a newer
build; its own repository is private. Building from the real upstream means **we set the peer
range ourselves**, which was the only reason to prefer the republish. Same playbook as the
CyberSource fork: small enough to read entirely, so own it.

**Rejected: `@easypayment/medusa-payment-paypal`**, which is more featureful and looked strongest.
Its module is named `paypal_onboarding`, it stores `seller_client_id` / `auth_code` / `shared_id`,
and its default `partnerServiceUrl` points at a third-party host
(`mbjtechnolabs.com/ppcp-seller-onboarding/…`). **It onboards YD as a seller under someone else's
partner account** — a question about where money settles, not a package choice.

## Local changes — TWO REAL BUGS, both proven against the live sandbox

### 1. `money()` — amounts were sent with raw `Number.toString()`
PayPal rejects more than two decimal places with `DECIMAL_PRECISION`, HTTP 422. Upstream sent
`amount.toString()`, so **any floating-point artefact is a hard checkout failure for that
customer.**

This is not an edge case. **An item plus sales tax reaches it immediately:**
`24.95 + 8.25% = 27.008375` → upstream sends `"27.008375"` → **422, payment fails.**

Verified against the sandbox: `"20"`, `"20.1"`, `"20.00"` accepted; `"20.005"` and
`"0.30000000000000004"` rejected. (`"1e3"` is also accepted, which is its own reason never to hand
PayPal a raw JS number.)

### 2. `itemTotal` was set to the ORDER TOTAL, not the sum of items
PayPal validates that `itemTotal + shipping (+ tax…)` equals the order amount to the cent, and
returns `ITEM_TOTAL_MISMATCH` otherwise. Upstream set `itemTotal` to the order total, so **every
order carrying shipping or tax fails** whenever line items are sent. **YD charges shipping below
$49**, so that is most orders.

Now computes `itemTotal` from the items and puts the remainder in `shipping`. If the breakdown
cannot be reconciled the itemised detail is dropped and the order total is sent alone —
**losing line items in PayPal's UI is cosmetic; an unreconciled breakdown is a failed checkout.**

### 3. Zero-amount orders were a broken checkout
PayPal **refuses** a zero-amount order — `CANNOT_BE_ZERO_OR_NEGATIVE`, HTTP 422 (verified: `0.00`
and `0` rejected, `0.01` accepted). Upstream had no zero handling, and worse, guarded with
`if (!amount ...)` — **`!0` is true**, so a legitimately free basket was rejected with *"Amount and
currency code are required"*.

**This is reachable today: YD has at least two live 100%-off codes** (`yoga100`, `Evolve50`, both
held for Jeff's review). A customer applying one and choosing PayPal gets a misleading error and a
dead checkout.

Now short-circuits: a fully-discounted basket never reaches PayPal, is marked authorized locally,
and completes — the same approach the CyberSource provider already takes for the same reason.

### 4. `money()` must unwrap Medusa's BigNumber
Medusa v2 passes amounts as **BigNumber objects, not numbers**. `Number(bigNumber)` is **NaN**,
which PayPal rejects with `INVALID_PARAMETER_SYNTAX`. Caught by typechecking against 2.19 —
upstream is pinned to 2.13 and never saw this type.

## Proof

`money.test.js` — **8/8 against the live PayPal sandbox**, asserting both that upstream's
behaviour FAILS and that the fix succeeds. Asserting only the fix would not have shown the bug is
real.

One note on method: my first artefact case used an expression that happens to come out exact, and
the test caught it by failing the "upstream should fail" assertion. That is why the upstream case
is asserted at all.

## Still to do

- Refunds exercised end to end (**not optional** — YD processes returns by hand).
- Webhook signature verification exercised, not just present in the code.
- **A real sandbox purchase driven through the storefront in a browser.** Nothing before that is
  evidence.
