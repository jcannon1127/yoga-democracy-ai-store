import { test } from "node:test"
import assert from "node:assert/strict"
import { dispatch, type DispatchIo } from "./dispatch.ts"
import { parseSendLog, deliveredSends } from "./outbox.ts"

const AT = "2026-08-25T12:00:00.000Z"

function io(over: Partial<DispatchIo> = {}) {
  const files = new Map<string, string>()
  const dirs: string[] = []
  const logs: string[] = []
  const base: DispatchIo = {
    now: () => AT,
    mkdir: (d) => { dirs.push(d) },
    writeFile: (p, c) => { files.set(p, c) },
    appendFile: (p, c) => { files.set(p, (files.get(p) ?? "") + c) },
    log: (l, m) => { logs.push(`${l} ${m}`) },
    ...over,
  }
  return { io: base, files, dirs, logs, log: () => files.get("outputs/email-sends.jsonl") ?? "" }
}

const reset = { reset_url: "https://x/reset?token=abc", email: "h@x.co" }

test("a preview writes the html, logs `preview`, and is NOT counted as delivered", async () => {
  const h = io()
  const r = await dispatch({ template: "password-reset", data: reset, to: "h@x.co",
    env: {}, io: h.io, order_id: "order_1" })

  assert.equal(r.delivered, false, "a file on disk is not an email")
  assert.equal(r.record.action, "preview")
  assert.ok(r.previewPath && h.files.get(r.previewPath)?.includes("<html"))
  // BOTH directories are created: the preview dir AND the send log's. Only the first was,
  // until 2026-08-26, and in production the log's did not exist so every append failed ENOENT.
  assert.deepEqual(h.dirs.sort(), ["outputs", "outputs/email-outbox"])

  const { records, malformed } = parseSendLog(h.log())
  assert.equal(malformed, 0)
  assert.equal(records.length, 1)
  assert.equal(deliveredSends(records).length, 0)
})

test("EVERY OUTCOME IS RECORDED, not just sends — coverage depends on it", async () => {
  const h = io()
  // skip: the template refuses (no reset_url), so nothing renders.
  await dispatch({ template: "password-reset", data: {}, to: "h@x.co", env: {}, io: h.io })
  // blocked: a real transport, a recipient off the allowlist.
  await dispatch({ template: "password-reset", data: reset, to: "stranger@x.co",
    env: { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://x", EMAIL_RECIPIENT_ALLOWLIST: "@yogademocracy.com" },
    io: h.io })
  // misconfigured: no recipient at all.
  await dispatch({ template: "password-reset", data: reset, to: "", env: {}, io: h.io })
  // misconfigured: unknown template id.
  await dispatch({ template: "not-a-template", data: {}, to: "h@x.co", env: {}, io: h.io })

  const { records } = parseSendLog(h.log())
  assert.deepEqual(records.map((r) => r.action),
    ["skip", "blocked", "misconfigured", "misconfigured"])
  assert.equal(deliveredSends(records).length, 0)
})

test("an unknown template is recorded and shouted about, and does NOT throw into the event bus", async () => {
  const h = io()
  const r = await dispatch({ template: "nope", data: {}, to: "h@x.co", env: {}, io: h.io })
  assert.equal(r.record.action, "misconfigured")
  assert.match(r.record.reason!, /unknown email template/)
  assert.match(h.logs.join(" "), /error .*unknown email template/)
})

test("a real send is the only thing that counts as delivered", async () => {
  const sent: unknown[] = []
  const h = io({ send: async (m) => { sent.push(m) } })
  const r = await dispatch({ template: "password-reset", data: reset, to: "h@yogademocracy.com",
    env: { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://x" }, io: h.io, order_id: "order_9" })

  assert.equal(r.delivered, true)
  assert.equal(r.record.action, "send")
  assert.equal(sent.length, 1)
  assert.equal(deliveredSends(parseSendLog(h.log()).records).length, 1)
})

test("A TRANSPORT THAT THROWS IS `failed`, NEVER `send` — it must not satisfy a reconciliation", async () => {
  const h = io({ send: async () => { throw new Error("connection refused") } })
  const r = await dispatch({ template: "password-reset", data: reset, to: "h@yogademocracy.com",
    env: { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://x" }, io: h.io, order_id: "order_9" })

  assert.equal(r.delivered, false)
  assert.equal(r.record.action, "failed")
  assert.match(r.record.reason!, /connection refused/)
  const { records } = parseSendLog(h.log())
  assert.equal(records.length, 1, "a failure still proves the logger was running")
  assert.equal(deliveredSends(records).length, 0, "a failed send is not a send")
  assert.match(h.logs.join(" "), /received NOTHING/)
})

test("configured to send with no transport supplied is misconfigured, not a silent preview", async () => {
  const h = io() // no io.send
  const r = await dispatch({ template: "password-reset", data: reset, to: "h@yogademocracy.com",
    env: { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://x" }, io: h.io })
  assert.equal(r.record.action, "misconfigured")
  assert.match(r.record.reason!, /no transport was provided/)
})

test("THE RECORD IS WRITTEN AFTER THE ACTION — a send that throws leaves no claim of delivery", async () => {
  const order: string[] = []
  const h = io({
    send: async () => { order.push("send"); throw new Error("boom") },
    appendFile: (_p, c) => { order.push(`log:${JSON.parse(c).action}`) },
  })
  await dispatch({ template: "password-reset", data: reset, to: "h@yogademocracy.com",
    env: { EMAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://x" }, io: h.io })
  assert.deepEqual(order, ["send", "log:failed"],
    "logging first would have claimed a delivery that never happened")
})

test("a send log that cannot be written is SHOUTED about — it is the reconciliation's only input", async () => {
  const h = io({ appendFile: () => { throw new Error("EACCES") } })
  const r = await dispatch({ template: "password-reset", data: reset, to: "h@x.co",
    env: {}, io: h.io, order_id: "order_3" })
  assert.equal(r.record.action, "preview", "the email still happened")
  assert.match(h.logs.join(" "), /COULD NOT WRITE THE SEND LOG.*now blind/)
})

test("a preview that cannot be written is `failed`, not `preview`", async () => {
  const h = io({ writeFile: () => { throw new Error("ENOSPC") } })
  const r = await dispatch({ template: "password-reset", data: reset, to: "h@x.co", env: {}, io: h.io })
  assert.equal(r.record.action, "failed")
  assert.match(r.record.reason!, /could not write preview/)
})

test("subject_id rides on the record, so per-certificate reconciliation has something to join on", async () => {
  const h = io()
  await dispatch({ template: "password-reset", data: reset, to: "h@x.co", env: {}, io: h.io,
    order_id: "order_7", subject_id: "gc_2" })
  const [rec] = parseSendLog(h.log()).records
  assert.equal(rec.order_id, "order_7")
  assert.equal(rec.subject_id, "gc_2")
})

test("every record is one line of valid JSON — the log stays parseable under append", async () => {
  const h = io()
  for (let i = 0; i < 5; i++) {
    await dispatch({ template: "password-reset", data: reset, to: `h${i}@x.co`, env: {}, io: h.io })
  }
  const text = h.log()
  assert.equal(text.split("\n").filter(Boolean).length, 5)
  assert.equal(parseSendLog(text).malformed, 0)
})

test("THE SEND LOG'S DIRECTORY IS CREATED — it was not, and production wrote nothing for a day", () => {
  // Regression for a live defect: the service's cwd is `.medusa/server`, the default log path
  // is relative, `outputs/` did not exist there, and every append failed ENOENT. The preview
  // directory was created; the log's was not.
  const made: string[] = []
  const appended: string[] = []
  const h = io({ mkdir: (d) => { made.push(d) }, appendFile: (p) => { appended.push(p) } })
  return dispatch({ template: "password-reset", data: reset, to: "h@realmail.co",
    env: { EMAIL_SEND_LOG: "outputs/nested/email-sends.jsonl" }, io: h.io, order_id: "o1" })
    .then(() => {
      assert.ok(made.includes("outputs/nested"),
        `send log directory was never created; mkdir saw ${JSON.stringify(made)}`)
      assert.ok(appended.includes("outputs/nested/email-sends.jsonl"))
    })
})

test("a bare filename with no directory still works", () => {
  const made: string[] = []
  const h = io({ mkdir: (d) => { made.push(d) } })
  return dispatch({ template: "password-reset", data: reset, to: "h@realmail.co",
    env: { EMAIL_SEND_LOG: "sends.jsonl" }, io: h.io }).then((r) => {
      assert.equal(r.record.action, "preview")
      assert.ok(made.includes("."), "dirname of a bare filename is '.'")
    })
})
