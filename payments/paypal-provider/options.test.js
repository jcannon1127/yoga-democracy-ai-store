/**
 * Asserts the PayPal provider FAILS SAFE on configuration.
 *
 * On 2026-08-24 YD's sandbox credentials were sent to https://api-m.paypal.com --
 * the LIVE API -- because `isSandbox` defaulted to false and the schema silently
 * stripped the unknown key `environment: "sandbox"` that was passed instead.
 *
 * These assert the RESULTING HOST, not the input, because the host is the thing
 * that has consequences.
 *
 * Run from apps/backend (needs the Medusa peers):
 *   node options.test.js <path-to-package-index.js>
 */
const path = process.argv[2]
const { default: provider } = require(path)
const Service = provider.services[0]
const creds = { clientId: "x", clientSecret: "y" }
const SANDBOX = "https://api-m.sandbox.paypal.com"
const LIVE = "https://api-m.paypal.com"

function hostFor(opts) {
  Service.validateOptions(opts)                  // throws on a bad shape
  const svc = new Service({ logger: console }, { ...opts })
  // reach the client the provider actually built
  const client = svc.client ?? svc._client
  return client?.baseUrl ?? "(could not read baseUrl)"
}

let fail = 0
const t = (name, fn) => {
  let ok = false, detail = ""
  try { const r = fn(); ok = r === true; detail = r === true ? "" : String(r) }
  catch (e) { detail = e.message.split("\n")[0].slice(0, 70) }
  if (!ok) fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -- " + detail}`)
}

t("omitting isSandbox talks to SANDBOX, not live", () => {
  const h = hostFor({ ...creds }); return h === SANDBOX || `got ${h}`
})
t("isSandbox:true talks to sandbox", () => {
  const h = hostFor({ ...creds, isSandbox: true }); return h === SANDBOX || `got ${h}`
})
t("isSandbox:false talks to LIVE (explicit opt-in still works)", () => {
  const h = hostFor({ ...creds, isSandbox: false }); return h === LIVE || `got ${h}`
})
t('environment:"sandbox" is REJECTED, not silently live', () => {
  try { hostFor({ ...creds, environment: "sandbox" }); return "accepted it" }
  catch { return true }
})
t("an unknown option is rejected (a typo cannot mean live)", () => {
  try { hostFor({ ...creds, sandbox: true }); return "accepted it" }
  catch { return true }
})
console.log(`\n  ${5 - fail}/5`)
process.exit(fail ? 1 : 0)
