/**
 * Run the event-name check against the Medusa actually installed here.
 *
 *   node --experimental-strip-types src/modules/email/check-events.ts
 *
 * **Exit codes are three, not two, and that is the point.**
 *   0  ok            — every wired name equals the name Medusa emits.
 *   1  mismatch      — an event was renamed or removed. Subscribers on the old name are
 *                      silent: they do not error, they simply never run.
 *   2  undetermined  — `@medusajs/utils` could not be resolved, so NOTHING WAS VERIFIED.
 *
 * Code 2 exists so that "could not check" cannot be mistaken for "checked and fine". A gate
 * that collapsed it into 0 would go green in exactly the environment where the check does
 * nothing — a worktree with no `node_modules`, which is where this file was written.
 */
import { checkEventNames, checkTemplateCoverage, WIRING, type MedusaEventConstants } from "./events.ts"
import { knownTemplates } from "./registry.ts"

const GROUPS = ["OrderWorkflowEvents", "FulfillmentWorkflowEvents", "AuthWorkflowEvents",
  "CustomerWorkflowEvents"] as const

async function loadConstants(): Promise<{ constants?: MedusaEventConstants; source: string }> {
  for (const spec of ["@medusajs/utils", "@medusajs/framework/utils"]) {
    try {
      const mod = (await import(spec)) as Record<string, unknown>
      const constants: MedusaEventConstants = {}
      let found = 0
      for (const g of GROUPS) {
        const v = mod[g] ?? (mod.default as Record<string, unknown> | undefined)?.[g]
        if (v && typeof v === "object") { constants[g] = v as Record<string, string>; found++ }
      }
      if (found) return { constants, source: `${spec}@${await versionOf(spec)}` }
    } catch { /* try the next specifier */ }
  }
  return { source: "@medusajs/utils (unresolvable)" }
}

/**
 * Which copy of Medusa did we actually compare against.
 *
 * **A check that does not say what it compared against is a check you cannot audit later.**
 * My own reconciliation already states its coverage window and refuses to pass without one;
 * this said only "ok", which is the same unqualified pass in a different place. yd-pdp lost
 * two days to a stale proxy answering every harness — *"the port answered, pages loaded,
 * numbers looked plausible"* — and the general form is that **an instrument should name its
 * source, so a stale one is visible rather than silently agreeable.**
 *
 * `unknown` if it cannot be read: never a guess, and never silence.
 */
async function versionOf(spec: string): Promise<string> {
  const pkg = spec.startsWith("@medusajs/framework") ? "@medusajs/framework" : "@medusajs/utils"
  const { createRequire } = await import("node:module")
  const req = createRequire(import.meta.url)

  // Direct is cleanest but modern packages block "./package.json" in their exports map, so
  // this falls back to resolving the entry point and walking up to the manifest. Both paths
  // read the SAME copy the import above used — a version from anywhere else would be exactly
  // the stale-source problem this is meant to expose.
  try { return req(`${pkg}/package.json`).version ?? "unknown" } catch { /* exports-restricted */ }
  try {
    const { dirname, join } = await import("node:path")
    const { readFileSync, existsSync } = await import("node:fs")
    let d = dirname(req.resolve(spec))
    for (let i = 0; i < 8; i++) {
      const m = join(d, "package.json")
      if (existsSync(m)) {
        const j = JSON.parse(readFileSync(m, "utf8"))
        if (j.name === pkg || j.version) return j.version ?? "unknown"
      }
      const up = dirname(d); if (up === d) break; d = up
    }
  } catch { /* fall through */ }
  return "unknown"
}

const { constants, source } = await loadConstants()
const events = checkEventNames(constants, source)
const coverage = checkTemplateCoverage(knownTemplates())

console.log(`email event wiring — ${WIRING.length} events, ${knownTemplates().length} templates`)
console.log(`  source: ${source}`)

if (coverage.state === "gaps") for (const p of coverage.problems) console.log(`  GAP  ${p}`)

switch (events.state) {
  case "ok":
    console.log(`  OK   ${events.checked} event names match Medusa's own constants`)
    for (const w of WIRING) console.log(`       ${w.event}  ->  ${w.template ?? "(none)"}`)
    process.exit(coverage.state === "gaps" ? 1 : 0)
  case "mismatch":
    for (const p of events.problems) console.log(`  FAIL ${p}`)
    process.exit(1)
  case "undetermined":
    console.log(`  ??   ${events.detail}`)
    process.exit(2)
}
