import { test } from "node:test"
import assert from "node:assert/strict"
import { parseSendLog, readSendLog, deliveredSends, formatRecord,
  type SendRecord, type FsLike } from "./outbox.ts"

const rec = (o: Partial<SendRecord> = {}): SendRecord => ({
  at: "2026-08-24T12:00:00Z", template: "order-confirmation", to: "a@b.co",
  order_id: "o1", action: "send", ...o })

const fsWith = (files: Record<string, string>): FsLike => ({
  existsSync: (p) => p in files,
  readFileSync: (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p] },
})

test("A MISSING LOG IS 'missing', NEVER AN EMPTY 'ok' — it is not evidence of no sends", () => {
  const r = readSendLog("/no/such/log.jsonl", fsWith({}))
  assert.equal(r.state, "missing")
  assert.notEqual(r.state, "ok")
  assert.match((r as { detail: string }).detail, /NOT the same as/)
})

test("an unconfigured path is unreadable, not missing and not empty", () => {
  assert.equal(readSendLog("", fsWith({})).state, "unreadable")
})

test("a readable log parses, and malformed lines are COUNTED not dropped", () => {
  const text = [formatRecord(rec()), "not json\n", formatRecord(rec({ order_id: "o2" })),
    JSON.stringify({ at: "x" }) + "\n", "\n"].join("")
  const r = readSendLog("/l.jsonl", fsWith({ "/l.jsonl": text }))
  assert.equal(r.state, "ok")
  assert.equal((r as { records: SendRecord[] }).records.length, 2)
  assert.equal((r as { malformed: number }).malformed, 2,
    "malformed lines were silently skipped — a corrupted log would read as missing sends")
})

test("a record missing the join fields is malformed, not a usable send", () => {
  const { records, malformed } = parseSendLog(
    JSON.stringify({ template: "x", action: "send" }) + "\n") // no `at`
  assert.equal(records.length, 0)
  assert.equal(malformed, 1)
})

test("ONLY action=send counts as delivered — a preview file is not an email", () => {
  const all = [rec({ action: "send" }), rec({ action: "preview" }), rec({ action: "skip" }),
    rec({ action: "blocked" }), rec({ action: "misconfigured" })]
  const d = deliveredSends(all)
  assert.equal(d.length, 1)
  assert.equal(d[0].action, "send")
})

test("a read that throws is unreadable, not empty", () => {
  const boom: FsLike = { existsSync: () => true,
    readFileSync: () => { throw new Error("EACCES") } }
  const r = readSendLog("/l.jsonl", boom)
  assert.equal(r.state, "unreadable")
  assert.match((r as { detail: string }).detail, /EACCES/)
})

test("formatRecord round-trips and never emits an embedded newline", () => {
  const r = rec({ reason: "line one\nline two" })
  const line = formatRecord(r)
  assert.equal(line.split("\n").length, 2, "an embedded newline would corrupt the next record")
  assert.deepEqual(parseSendLog(line).records[0], r)
})
