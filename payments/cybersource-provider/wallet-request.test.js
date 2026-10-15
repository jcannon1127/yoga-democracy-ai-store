// Intercepts PaymentsApi.createPayment to inspect the request the client builds.
// Cannot authorize (merchant unprovisioned), but CAN prove the request shape.
const CS = require('cybersource-rest-client')
const captured = []
CS.PaymentsApi = function () {
  return { createPayment: (req, cb) => { captured.push(req); cb(null, { id: 'FAKE', status: 'AUTHORIZED' }) } }
}
const { CybersourceClient } = require('./.medusa/server/src/client/cybersource-client.js')
const c = new CybersourceClient({
  merchantID: 'm', merchantKeyId: 'k', merchantsecretKey: 's', environment: 'sandbox',
})

const billTo = { firstName: 'A', lastName: 'B', address1: '1 Main', locality: 'Indianapolis',
                 administrativeArea: 'IN', postalCode: '46240', country: 'US', email: 'a@b.co' }

;(async () => {
  await c.authorizeWallet({ walletType: 'apple_pay', walletPayload: 'BASE64APPLE',
    amount: '42.00', currency: 'USD', referenceCode: 'ref1', capture: false,
    fingerprintSessionId: 'fp-1', billTo })
  await c.authorizeWallet({ walletType: 'google_pay', walletPayload: 'BASE64GOOGLE',
    amount: '19.99', currency: 'USD', referenceCode: 'ref2', capture: true, billTo })
  await c.authorizePayment({ transientToken: 'FLEXJWT', amount: '10.00', currency: 'USD',
    referenceCode: 'ref3', capture: false, billTo })

  const [apple, google, card] = captured
  const checks = [
    ['apple paymentSolution is 001', apple.processingInformation.paymentSolution === '001'],
    ['apple payload in fluidData.value', apple.paymentInformation.fluidData.value === 'BASE64APPLE'],
    ['apple descriptor = FID=COMMON.APPLE.INAPP.PAYMENT',
      Buffer.from(apple.paymentInformation.fluidData.descriptor, 'base64').toString() === 'FID=COMMON.APPLE.INAPP.PAYMENT'],
    ['apple carries NO transient token', !apple.tokenInformation],
    ['apple keeps the fraud fingerprint', apple.deviceInformation?.fingerprintSessionId === 'fp-1'],
    ['apple keeps billTo', apple.orderInformation.billTo.postalCode === '46240'],
    ['apple amount/currency intact', apple.orderInformation.amountDetails.totalAmount === '42.00'],
    ['apple reference = idempotency key', apple.clientReferenceInformation.code === 'ref1'],
    ['google paymentSolution is 012', google.processingInformation.paymentSolution === '012'],
    ['google has NO descriptor', google.paymentInformation.fluidData.descriptor === undefined],
    ['google honours capture=true', google.processingInformation.capture === true],
    ['card path UNCHANGED: no paymentSolution', card.processingInformation.paymentSolution === undefined],
    ['card path UNCHANGED: no fluidData', !card.paymentInformation],
    ['card path UNCHANGED: transient token set', card.tokenInformation.transientTokenJwt === 'FLEXJWT'],
  ]
  let f = 0
  for (const [name, ok] of checks) { if (!ok) f++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`) }
  console.log(`\n  ${checks.length - f}/${checks.length} passed`)
  process.exit(f ? 1 : 0)
})()
