# Build provenance — PayPal provider (YD fork)

**Built from:** branch `yd-pay`, commit `0843bcabdab6595725075ab4e49afebdff15d450`
**Built on:** 2026-08-24, against Medusa **2.19.0**
**Source of truth:** `payments/paypal-provider/` on branch `yd-pay`.
**This directory is a build artifact — never edit it in place.** Edits here are lost on the next
build and make the source and the running code disagree silently.

## Upstream

[alphabite-dev/medusa-paypal](https://github.com/alphabite-dev/medusa-paypal) `@alphabite/medusa-paypal` 0.2.6.
`package.json` declares **MIT** and npm lists MIT, but **the repository contains no LICENSE file**
and GitHub detects none — declared but unfiled. Recorded rather than hidden.
Marked `0.2.6-yd.1`, `private: true`, so it can never shadow upstream if published.

## THE ARTEFACT IS NOT IN GIT. `COMMIT` IS THE ONLY LINK BACK TO ITS SOURCE.

`.medusa/` here is **gitignored** (`apps/backend/.gitignore:26`). Six files are tracked — this one,
`COMMIT`, `package.json` and three tests — and **the compiled provider that the store actually runs
is tracked nowhere, on any branch.**

That cuts both ways, and both halves matter:

- **A `git checkout` or `git stash` CANNOT restore an older provider**, because git holds none. Anyone
  reasoning about the risk that way is protecting against the wrong thing.
- **The artefact exists in exactly one directory on one machine.** Delete it, or rebuild it from an
  older source commit, and a fix disappears with nothing in git showing that it did. **`COMMIT` is the
  only record of which source produced what is installed** — which is why it is bumped in the same
  commit as the source change, and why a mismatch between it and the branch is worth treating as
  suspicious rather than untidy.

Rebuild it with `npm run build` in `payments/paypal-provider/` at the commit named in `COMMIT`.

### STAMP `COMMIT` AFTER COMMITTING THE SOURCE, NOT BEFORE

I got this wrong on 2026-08-26 and it cost someone else an hour. The staging step ran
`git rev-parse HEAD > COMMIT` **while the refund fix was still uncommitted**, so the file named
`9d460ab` — a commit whose source does **not** contain the fix that is compiled into the running
provider. Three different values were then in play across two checkouts, and **the one file whose
job is to say what is installed was the one lying.**

The order that cannot go wrong:

    1. commit the source change
    2. npm run build          (in payments/paypal-provider/)
    3. git rev-parse HEAD > vendor/paypal-provider/COMMIT   <- IN YOUR WORKTREE
    4. commit and push that stamp                            <- the step I missed
    5. rebuild.sh

**Step 4 is not bookkeeping.** On 2026-08-26 I followed 1-3 correctly for the webhook fix but wrote
the stamp only into the integration checkout, never back onto the branch. The result: `main` recorded
`a9d0a73` while the installed provider was built from `31b59b7`, and the file whose job is to say what
is installed disagreed with what was installed **for the second time in twelve hours**. The first time
the stamp was written too early; this time it was written in the wrong place. **Same file, same
consequence, and the consequence is silent — the next person to reason from it is wrong without
knowing.**

**If you need to know which source an installed artefact came from, do not trust `COMMIT` alone —
grep the compiled file for a string the fix introduced and check which commits contain it.** That is
how the 2026-08-26 mismatch was settled:

    git show <commit>:payments/paypal-provider/src/.../service.ts | grep -c "<marker>"
    grep -c "<marker>" .medusa/server/node_modules/@alphabite/medusa-paypal/.medusa/server/src/.../service.js

## Six bugs fixed, all proven against the live PayPal sandbox

1. **Amounts sent via raw `Number.toString()`** — PayPal rejects >2 decimals with
   `DECIMAL_PRECISION`. An item plus sales tax (24.95 + 8.25% = 27.008375) fails immediately.
2. **`itemTotal` set to the ORDER TOTAL** rather than the sum of items — `ITEM_TOTAL_MISMATCH` on
   any order with shipping. **YD charges shipping below $49, so that is most orders.**
3. **Zero-amount orders were a dead checkout.** PayPal refuses $0
   (`CANNOT_BE_ZERO_OR_NEGATIVE`), and upstream guarded with `if (!amount)` — **`!0` is true** — so
   a free basket died with *"Amount and currency code are required"*. **YD has two live 100%-off
   codes** (`yoga100`, `Evolve50`), so this was reachable today.
4. **`money()` must unwrap Medusa's BigNumber.** `Number(bigNumber)` is `NaN`, which PayPal
   rejects with `INVALID_PARAMETER_SYNTAX`. Caught by typechecking against 2.19; upstream is
   pinned to 2.13 and never saw the type.

Also: devDeps aligned to 2.19 (`@swc/core` 1.5.7 → ^1.7.28) and a permissive peer range.

5. **`authorizePayment` CAPTURED the money and reported AUTHORIZED.** PayPal orders are created with
   `intent: CAPTURE`, so approval settles the money — and upstream returned `AUTHORIZED`, leaving
   Medusa with `captured_at` NULL, collection `authorized` and zero capture rows against money PayPal
   had taken. Nothing errored; the order simply sat `pending` and reconciled as unpaid revenue.
   Reproduced twice, fixed, and confirmed absent on two purchases through a build someone else
   deployed.
6. **EVERY REFUND WAS A FULL REFUND.** `refundPayment` never read `input.amount`, and
   `refundCapturedPayment({ captureId })` with no body means "refund everything" to PayPal. **A $10
   refund on a $75 order returned $75.00** (refund `35N49397GK419322S`, capture REFUNDED) while Medusa
   recorded $10 — **$65 given away with the books looking tidy.** Now sends the amount, and **refuses
   rather than guesses** when an amount would span several captures.

`money.test.js`: **8/8 against the live sandbox**, asserting upstream **fails** as well as that the
fix passes. `capture-status.test.js`: **2/4 against the pre-fix artefact, 4/4 after** — run it against
the INSTALLED copy from inside `apps/backend`.

## ⚠️ RUNTIME DEPENDENCIES MUST BE INSTALLED SEPARATELY

Unlike the CyberSource artifact, this one has runtime dependencies and **copying it is not
enough**:

    @paypal/paypal-server-sdk  1.0.0
    libphonenumber-js          ^1.12.9

**Neither is currently present in the backend, nor in `.medusa/server`** (checked 2026-08-24).
`npm install file:<artifact>` into a bare project installs the package and **not** its
dependencies — verified. So they must be added to `apps/backend/package.json` so that
`rebuild.sh`'s production install pulls them into the build output.

**Failure mode if missed:** the provider resolves, registers, and throws `MODULE_NOT_FOUND` at
first use — which is the "registered but not functional" third state that hid the CyberSource
`targetOrigins` bug for a day.

## Install shape — copy, do NOT use a `file:` dependency

`file:` symlinks, and Node resolves peers from the symlink's realpath, so the package cannot see
`@medusajs/framework`. **That took Medusa down for twelve minutes on 2026-08-22.** Copy into
`node_modules`, and have `rebuild.sh` re-copy after `npm install`, because npm prunes what is not
in `package.json`.

## Verification order — only the last one is evidence

**Run every check from inside , against the INSTALLED copy — not against this
staging directory.** The Medusa peer dependencies do not resolve from here, so a check run in
place fails for the wrong reason. I made exactly that mistake verifying this cut.

1. `rebuild.sh` — **a restart does not deploy backend source.**
2. `node -e "require('@alphabite/medusa-paypal')"` inside `apps/backend`.
2b. **`node loadable.test.js` inside `apps/backend` — RESOLVABILITY IS NOT LOADABILITY.**
   The previous cut resolved perfectly and exported nothing usable; Medusa died with
   `moduleProviderServices is not iterable` during module load, before the server existed, and
   systemd restart-looped. Step 2 passed throughout. This asserts `services` is a non-empty array
   of constructibles, takes one second, and needs no running service — which matters because
   step 3 requires a service that this class of bug prevents from starting.
3. Provider appears in `/store/payment-providers?region_id=…`.
4. **A real sandbox purchase driven through the storefront in a browser.**

## ⚠️ THE OPTION IS `isSandbox`, AND OMITTING IT USED TO MEAN PRODUCTION

```ts
{
  resolve: "@alphabite/medusa-paypal",
  id: "paypal",
  options: {
    clientId:     process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    isSandbox:    process.env.PAYPAL_ENVIRONMENT !== "production",
    webhookId:    process.env.PAYPAL_WEBHOOK_ID,
  },
}
```

**It is `isSandbox: boolean`, NOT `environment: string`.** CyberSource takes `environment`, so
anyone reusing that recipe reaches for it — and on 2026-08-24 that sent YD's sandbox credentials
to the **LIVE** PayPal API, because zod silently stripped the unknown key and `isSandbox`
defaulted to false.

**Fixed in this fork so it cannot recur:**
- `isSandbox` defaults to **true**. Production requires explicit opt-in.
- The schema is `.strict()`, so any unrecognised option **throws** instead of meaning live.
- `environment` is rejected **by name**, with a message saying what to use instead.
- The constructor now uses the **parsed** options. Upstream validated with `safeParse` and
  discarded the result, so every schema default was decorative — an omitted `isSandbox` was
  `undefined`, which is falsy, which is production.

Verified by `options.test.js` (5/5), which asserts the resulting **host** rather than the option
value. An earlier version of that test checked the value and passed while the provider still
talked to production.

## Sandbox only

Credentials at `~/.config/yd-pay/paypal-sandbox.env`. **Live credentials exist and must NOT be
used** until the sandbox flow works, the operations agent is told, and Jeff approves. Environment is a
config value, never a code path.
