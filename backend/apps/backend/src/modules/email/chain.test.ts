import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync,
  appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dispatch, type DispatchIo } from "./providers/dispatch.ts"
import { readSendLog } from "./providers/outbox.ts"
import { reconcileFromLog } from "./reconcile.ts"

/**
 * THE JOIN, END TO END, WITH REAL FILES: dispatch writes -> readSendLog reads -> reconcile judges.
 *
 * **Every piece of this chain was well tested and the chain itself had never run.** No test
 * imported both `dispatch` and `reconcile`, and every reconciliation test built its `SendLog`
 * by hand — so nothing had ever confirmed that what `dispatch` actually writes is what
 * `readSendLog` can actually parse and `reconcileFromLog` can actually judge.
 *
 * **This lane has been bitten twice in exactly that gap.** The 100x money error lived only in
 * the join between Medusa's decimals and a template expecting cents; the outage lived only in
 * the join between a source file and the loader that had to require it. **Both halves were
 * green in both cases.** A seam nothing crosses is a seam nothing tests.
 */
function realIo(dir: string, send?: DispatchIo["send"]): DispatchIo {
  let n = 0
  return {
    now: () => new Date(Date.parse("2026-08-26T10:00:00Z") + n++ * 1000).toISOString(),
    mkdir: (d) => { mkdirSync(d, { recursive: true }) },
    writeFile: (p, c) => { writeFileSync(p, c, "utf8") },
    appendFile: (p, c) => { appendFileSync(p, c, "utf8") },
    ...(send ? { send } : {}),
  }
}
const RESET = { reset_url: "https://x/r?t=1", email: "h@realmail.co" }
// Orders must fall INSIDE the log's coverage window (its first record is 10:00:00Z). Dating
// them before it makes every one `uncovered` and the verdict `undetermined` — which is the
// coverage guard working, and it caught this fixture being wrong before the fixture could
// quietly assert a pass that meant nothing.
const orderRefs = (ids: string[]) =>
  ids.map((id) => ({ id, created_at: "2026-08-26T10:30:00Z" }))

test("CHAIN: a real send is written, read back off disk, and reconciles clean", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yd-chain-"))
  try {
    const env = { EMAIL_SEND_LOG: join(dir, "sends.jsonl"), EMAIL_TRANSPORT: "smtp",
      SMTP_URL: "smtp://x" }
    const io = realIo(dir, async () => {})
    for (const id of ["order_1", "order_2", "order_3"]) {
      await dispatch({ template: "password-reset", data: RESET, to: "h@realmail.co",
        env, io, order_id: id })
    }
    // read it back the way the reconciliation does — real file, real fs
    const log = readSendLog(env.EMAIL_SEND_LOG, { existsSync, readFileSync })
    assert.equal(log.state, "ok")
    assert.equal((log as { malformed: number }).malformed, 0, "dispatch wrote something unparseable")

    const r = reconcileFromLog(orderRefs(["order_1", "order_2", "order_3"]), log, "password-reset")
    assert.equal(r.verdict, "pass", r.detail)
    assert.match(r.detail, /log covers from/, "a pass must state its coverage window")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("CHAIN CAN FAIL: an order nothing dispatched is named, from the real file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yd-chain-"))
  try {
    const env = { EMAIL_SEND_LOG: join(dir, "sends.jsonl"), EMAIL_TRANSPORT: "smtp",
      SMTP_URL: "smtp://x" }
    const io = realIo(dir, async () => {})
    for (const id of ["order_1", "order_2"]) {
      await dispatch({ template: "password-reset", data: RESET, to: "h@realmail.co",
        env, io, order_id: id })
    }
    const log = readSendLog(env.EMAIL_SEND_LOG, { existsSync, readFileSync })
    const r = reconcileFromLog(orderRefs(["order_1", "order_2", "order_3"]), log, "password-reset")
    assert.equal(r.verdict, "fail")
    assert.deepEqual(r.missing, ["order_3"])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("CHAIN: IN PREVIEW MODE NOTHING RECONCILES CLEAN — a file on disk is not an email", async () => {
  // Verified end to end for the first time here. The rule was asserted in outbox's unit tests
  // against a hand-built log; this proves what dispatch ACTUALLY writes in the mode the lane
  // ships in today produces the honest verdict rather than a flattering one.
  const dir = mkdtempSync(join(tmpdir(), "yd-chain-"))
  try {
    const env = { EMAIL_SEND_LOG: join(dir, "sends.jsonl"), EMAIL_PREVIEW_DIR: join(dir, "prev") }
    const io = realIo(dir)
    for (const id of ["order_1", "order_2"]) {
      await dispatch({ template: "password-reset", data: RESET, to: "h@realmail.co",
        env, io, order_id: id })
    }
    const log = readSendLog(env.EMAIL_SEND_LOG, { existsSync, readFileSync })
    assert.equal(log.state, "ok")
    assert.equal((log as { records: unknown[] }).records.length, 2, "previews are still recorded")

    const r = reconcileFromLog(orderRefs(["order_1", "order_2"]), log, "password-reset")
    assert.equal(r.verdict, "fail", "previews must never satisfy a reconciliation")
    assert.deepEqual(r.missing.sort(), ["order_1", "order_2"])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("CHAIN: no log file at all is UNDETERMINED, not a clean bill of health", () => {
  const dir = mkdtempSync(join(tmpdir(), "yd-chain-"))
  try {
    const log = readSendLog(join(dir, "never-written.jsonl"), { existsSync, readFileSync })
    assert.equal(log.state, "missing")
    const r = reconcileFromLog(orderRefs(["order_1"]), log, "password-reset")
    assert.equal(r.verdict, "undetermined")
    assert.deepEqual(r.missing, [], "an unreadable log must not invent missing sends")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("CHAIN: an order predating the log cannot be judged, and blocks a pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yd-chain-"))
  try {
    const env = { EMAIL_SEND_LOG: join(dir, "sends.jsonl"), EMAIL_TRANSPORT: "smtp",
      SMTP_URL: "smtp://x" }
    await dispatch({ template: "password-reset", data: RESET, to: "h@realmail.co",
      env, io: realIo(dir, async () => {}), order_id: "order_new" })
    const log = readSendLog(env.EMAIL_SEND_LOG, { existsSync, readFileSync })
    const r = reconcileFromLog(
      [{ id: "order_new", created_at: "2026-08-26T10:30:00Z" },
       { id: "order_ancient", created_at: "2020-01-01T00:00:00Z" }], log, "password-reset")
    assert.notEqual(r.verdict, "pass", "a blind spot must not read as clean")
    assert.deepEqual(r.uncovered, ["order_ancient"])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
