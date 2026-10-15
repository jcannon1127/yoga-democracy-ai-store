// Proves the two fixes against the LIVE PayPal sandbox, not against a stub.
const { execSync } = require('child_process')
const fs = require('fs')

// Mirrors money() in paypal-core.ts, including the BigNumber unwrap.
function money(value) {
  let n
  if (typeof value === 'object' && value !== null) {
    n = parseFloat(String(value.value ?? value.numeric))
  } else {
    n = typeof value === 'number' ? value : Number(value)
  }
  if (!Number.isFinite(n)) throw new Error(`non-finite ${JSON.stringify(value)}`)
  return n.toFixed(2)
}

// Medusa v2 hands amounts over as BigNumber objects, not numbers.
const BIGNUM = { value: "27.008375" }
const BIGNUM_RAW_FAILS = String(Number(BIGNUM))   // "NaN"

const env = {}
for (const line of fs.readFileSync(process.env.HOME + '/.config/yd-pay/paypal-sandbox.env', 'utf8').split('\n')) {
  if (line && !line.startsWith('#') && line.includes('=')) { const [k, ...v] = line.split('='); env[k.trim()] = v.join('=').trim() }
}
const token = JSON.parse(execSync(
  `curl -s https://api-m.sandbox.paypal.com/v1/oauth2/token -u '${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}' -d grant_type=client_credentials`
).toString()).access_token

function createOrder(body) {
  const out = execSync(`curl -s -X POST https://api-m.sandbox.paypal.com/v2/checkout/orders ` +
    `-H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`).toString()
  const d = JSON.parse(out)
  return d.id ? { ok: true } : { ok: false, issue: (d.details || [{}])[0].issue }
}

const cases = []
// 1. money() defuses float artefacts that upstream's toString() would send raw
// A genuine float artefact. My first attempt used an expression that happens to
// come out exact -- the test caught my own bad case, which is the point of
// asserting the upstream behaviour fails rather than only that the fix passes.
const bad = 10.1 + 10.2                          // 20.299999999999997
// And the case YD will actually hit: an item plus sales tax.
const taxed = 24.95 + 0.0825 * 24.95             // 27.008375
cases.push(['float artefact via toString (upstream)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: String(bad) } }] }), false])
cases.push(['float artefact via money() (fixed)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: money(bad) } }] }), true])
cases.push(['item + sales tax via toString (upstream)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: String(taxed) } }] }), false])
cases.push(['item + sales tax via money() (fixed)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: money(taxed) } }] }), true])

// 2. breakdown reconciliation, with shipping -- the ordinary YD order under $49
const items = [{ unit_price: 20, quantity: 1 }]
const amount = 29.99
const itemTotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
const shipping = Number((amount - itemTotal).toFixed(2))
cases.push(['itemTotal = order total (upstream)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: money(amount),
    breakdown: { item_total: { currency_code: 'USD', value: money(amount) } } },
    items: [{ name: 'Tank', quantity: '1', unit_amount: { currency_code: 'USD', value: money(20) } }] }] }), false])
cases.push(['itemTotal + shipping reconciled (fixed)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: money(amount),
    breakdown: { item_total: { currency_code: 'USD', value: money(itemTotal) },
                 shipping: { currency_code: 'USD', value: money(shipping) } } },
    items: [{ name: 'Tank', quantity: '1', unit_amount: { currency_code: 'USD', value: money(20) } }] }] }), true])

cases.push(['BigNumber via Number() (what upstream did)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: BIGNUM_RAW_FAILS } }] }), false])
cases.push(['BigNumber via money() (fixed)', createOrder({ intent: 'CAPTURE',
  purchase_units: [{ amount: { currency_code: 'USD', value: money(BIGNUM) } }] }), true])

let fail = 0
for (const [name, res, wantOk] of cases) {
  const ok = res.ok === wantOk
  if (!ok) fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} -> ${res.ok ? 'created' : res.issue}`)
}
console.log(`\n  ${cases.length - fail}/${cases.length} passed  (money(${bad}) = ${money(bad)}, money(BigNumber) = ${money(BIGNUM)}, Number(BigNumber) = ${BIGNUM_RAW_FAILS})`)
process.exit(fail ? 1 : 0)
