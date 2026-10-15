/**
 * Asserts the package is LOADABLE, not merely resolvable.
 *
 * `require()` succeeding proves the file exists. It does NOT prove Medusa can use
 * it. Upstream's barrel exported only types: it resolved perfectly, exported
 * nothing usable, and Medusa died with `moduleProviderServices is not iterable`
 * during module load -- before the server existed, so systemd restart-looped and
 * the store was down six minutes (2026-08-24).
 *
 * Run from inside apps/backend, where the Medusa peer dependencies exist.
 *   node loadable.test.js [path-to-package-or-name]
 */
const target = process.argv[2] || "@alphabite/medusa-paypal"
const unwrap = (x) => (x && x.default !== undefined ? x.default : x)

let mod
try {
  mod = require(target)
} catch (e) {
  console.log(`  FAIL  require("${target}") threw: ${e.message.split("\n")[0]}`)
  process.exit(1)
}
console.log(`  PASS  resolves`)

const def = unwrap(mod)
const checks = [
  ["default export is an object", def && typeof def === "object"],
  ["carries a `services` array", Array.isArray(def && def.services)],
  ["`services` is non-empty", Array.isArray(def && def.services) && def.services.length > 0],
  ["service is constructible", (() => {
      const S = def && def.services && def.services[0]
      return typeof S === "function" && typeof S.prototype === "object"
    })()],
]
let fail = 0
for (const [name, ok] of checks) {
  if (!ok) fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`)
}
if (fail) {
  console.log(`\n  ${target} resolves but is NOT loadable by Medusa.`)
  console.log(`  This is the state that looks healthy to every cheap check and`)
  console.log(`  restart-loops the service on deploy.`)
}
process.exit(fail ? 1 : 0)
