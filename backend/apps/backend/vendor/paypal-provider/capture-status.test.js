/**
 * The capture/authorize posture, asserted against the COMPILED artifact.
 *
 * Two real sandbox purchases on 2026-08-25 left PayPal holding a COMPLETED
 * capture while Medusa recorded `authorized`, `captured_at` NULL and zero
 * capture rows. `authorizePayment` captures the money (intent=CAPTURE) and then
 * reported AUTHORIZED. Nothing errored, so only reconciliation would ever have
 * found it.
 *
 * These cases fail against the upstream artifact and pass against the fork,
 * which is the only way to know the fix is what changed the behaviour.
 *
 *   node capture-status.test.js      (run from inside apps/backend)
 */
const assert = require("assert");
const path = require("path");

const PKG = process.env.PAYPAL_PKG || "@alphabite/medusa-paypal";
const { PaymentSessionStatus } = require("@medusajs/framework/utils");
const Service =
  require(path.join(require.resolve(PKG + "/package.json"), "..",
    ".medusa/server/src/providers/paypal/service.js")).default;

const svc = Object.create(Service.prototype);
svc.logger = { error() {}, info() {}, warn() {} };

// The stub stands in for PayPal. `captureOrder` returns whatever this case says
// PayPal did -- that is the whole variable under test. `createOrder` throws,
// because it is only reached on a DECLINED capture, and a case that lands there
// is testing something other than what it claims to.
let captureResult = null;
svc.client = {
  captureOrder: async () => captureResult,
  createOrder: async () => {
    throw new Error("createOrder reached -- this case took the decline path");
  },
};

const order = (captureStatus) => ({
  id: "0VB510298G933213B",
  amount: 75,
  currency_code: "usd",
  purchaseUnits: [
    captureStatus
      ? { payments: { captures: [{ status: captureStatus, amount: { value: "75.00" } }] } }
      : { payments: { captures: [] } },
  ],
});

let pass = 0, fail = 0;
async function check(name, expected, data) {
  try {
    const out = await svc.authorizePayment({ data, context: {} });
    assert.strictEqual(out.status, expected,
      `expected ${expected}, got ${out.status}`);
    console.log(`  ok    ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    fail++;
  }
}

(async () => {
  // 1. THE REGRESSION, in the shape the real purchase produced: the session
  //    already carries a COMPLETED capture, so no network call happens at all.
  //    Upstream returns AUTHORIZED here and the money is already gone.
  captureResult = null;
  await check("already-settled session -> CAPTURED", PaymentSessionStatus.CAPTURED,
    order("COMPLETED"));

  // 2. The live flow: nothing captured yet, PayPal captures on approval.
  captureResult = order("COMPLETED");
  await check("captureOrder settles -> CAPTURED", PaymentSessionStatus.CAPTURED,
    order(null));

  // 3. THE CONTROL. Without it a provider hardcoded to CAPTURED passes 1 and 2
  //    and reports money PayPal never took -- the same failure, inverted.
  captureResult = order("PENDING");
  await check("capture not completed -> AUTHORIZED", PaymentSessionStatus.AUTHORIZED,
    order(null));

  // 4. The free-basket path predates this change and keeps its own posture:
  //    nothing went to PayPal, so there is nothing to capture.
  captureResult = null;
  await check("free order -> captured (local)", "captured",
    { free_order: true, amount: 0, currency_code: "usd", id: "free" });

  console.log(`\n  ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
