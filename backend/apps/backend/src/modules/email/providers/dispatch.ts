/**
 * The one function that actually does something — render, decide, act, record.
 *
 * **Until this file existed the lane had a decision layer nobody executed and a send log
 * nobody wrote.** `decideDelivery` returned a `Delivery` and returned it to no one;
 * `readSendLog` read a file nothing appended to. The reconciliation was therefore permanently in its
 * `missing` state by construction — correct, honest, and completely uninformative. This is
 * the join, and it is deliberately the only place in the lane with side effects.
 *
 * ── FOUR RULES, EACH OF WHICH IS A DECISION THAT COULD HAVE GONE THE OTHER WAY ───────────
 *
 * 1. **A record is written for EVERY outcome — skip, blocked, misconfigured and failed
 *    included, not only for sends.** The reconciliation computes its coverage window from
 *    every record, precisely so that a period in which nothing was successfully sent reads as
 *    "watched, and nothing went out" rather than as "nobody was watching". Recording only
 *    successes would turn the exact failure this lane hunts into a blind spot.
 *
 * 2. **The record is written AFTER the action, never before.** The two orderings fail in
 *    opposite directions and one is much worse. Writing first means a crash mid-send leaves a
 *    log claiming an email the customer never got — the reconciliation then reports a clean
 *    bill of health over a real failure. Writing last means a crash loses the record of an
 *    email that DID go out, and the reconciliation reports a missing send that a human checks
 *    and dismisses. **A false alarm costs someone five minutes; false calm costs a customer.**
 *
 * 3. **A transport exception is its own action, `failed` — not `send`, not `skip`, not
 *    `misconfigured`.** `send` would assert a delivery that did not happen; `skip` would call
 *    it deliberate; `misconfigured` would blame the configuration for what may be a timeout.
 *    `deliveredSends` counts only `send`, so a failure can never satisfy a reconciliation.
 *
 * 4. **An unknown template id is recorded and logged loudly, and NOT rethrown.** Throwing out
 *    of a subscriber hands the event back to the bus, which retries it; no number of retries
 *    fixes a typo in a template id, so the only result is the same fault repeated until the
 *    log is unreadable. The durable record plus an error line is louder in practice, and the
 *    reconciliation will show the order un-emailed regardless.
 */
import { render, UnknownTemplateError } from "../registry.ts"
import { decideDelivery, type Env } from "./delivery.ts"
import { formatRecord, type SendRecord } from "./outbox.ts"

export type DispatchIo = {
  /** Create a directory and its parents. */
  mkdir: (dir: string) => void
  writeFile: (path: string, contents: string) => void
  /** MUST append atomically — the send log's crash-safety depends on it. */
  appendFile: (path: string, contents: string) => void
  /** ISO 8601 UTC. Injected so records are deterministic under test. */
  now: () => string
  /** Only ever called for a `send` decision. Absent means no transport is wired. */
  send?: (msg: { via: string; to: string; subject: string; html: string }) => Promise<void>
  log?: (level: "info" | "error", message: string) => void
}

export type DispatchOutcome = {
  record: SendRecord
  /** True only when a real message reached a transport. A preview is not a delivery. */
  delivered: boolean
  /** Where the preview was written, when there was one. */
  previewPath?: string
}

const MARKER = "[email]"

/** Filesystem-safe, and short enough to stay readable in a directory listing. */
function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unknown"
}

export async function dispatch(args: {
  template: string
  data: Record<string, unknown>
  to: string
  env: Env
  io: DispatchIo
  /** For reconciliation. Order-scoped mail sets this. */
  order_id?: string
  /** For mail an order can need SEVERAL of — gift certificates, parcels. */
  subject_id?: string
}): Promise<DispatchOutcome> {
  const { template, data, to, env, io } = args
  const at = io.now()
  const logPath = env.EMAIL_SEND_LOG || "outputs/email-sends.jsonl"

  const write = (r: Omit<SendRecord, "at" | "template" | "to">): SendRecord => {
    const record: SendRecord = {
      at, template, to,
      ...(args.order_id ? { order_id: args.order_id } : {}),
      ...(args.subject_id ? { subject_id: args.subject_id } : {}),
      ...r,
    }
    try {
      // **The send log's directory has to exist, and nothing was creating it.** Found in
      // production 2026-08-26: the service runs with cwd `.medusa/server`, the default path is
      // relative (`outputs/email-sends.jsonl`), and `outputs/` does not exist there — so every
      // append failed ENOENT and THE RECONCILIATION'S ONLY INPUT HAD NEVER BEEN WRITTEN. The
      // preview directory was created (below); the log's was not. The error handler did shout,
      // correctly and precisely, into a 167MB file nobody reads — which is why the fix is to
      // create the directory, not to log more loudly.
      const dir = logPath.includes("/") ? logPath.slice(0, logPath.lastIndexOf("/")) : "."
      io.mkdir(dir)
      io.appendFile(logPath, formatRecord(record))
    } catch (e) {
      // The log is the reconciliation's only input. Losing it silently would leave the
      // reconciliation reporting `missing` — "cannot tell" — with nobody knowing why.
      io.log?.("error",
        `${MARKER} COULD NOT WRITE THE SEND LOG at ${logPath}: ${(e as Error).message} — ` +
        `reconciliation for ${template}/${args.order_id ?? to} is now blind.`)
    }
    return record
  }

  let rendered
  try {
    rendered = render(template, data)
  } catch (e) {
    const reason = e instanceof UnknownTemplateError
      ? e.message
      : `template ${template} threw while rendering: ${(e as Error).message}`
    io.log?.("error", `${MARKER} ${reason}`)
    return { record: write({ action: "misconfigured", reason }), delivered: false }
  }

  const decision = decideDelivery(rendered, to, env)

  switch (decision.action) {
    case "skip":
      io.log?.("info", `${MARKER} skip template=${template} reason=${decision.reason}`)
      return { record: write({ action: "skip", reason: decision.reason }), delivered: false }

    case "blocked":
    case "misconfigured":
      io.log?.("error", `${MARKER} ${decision.action} template=${template} reason=${decision.reason}`)
      return { record: write({ action: decision.action, reason: decision.reason }), delivered: false }

    case "preview": {
      const name = `${slug(at)}-${slug(template)}-${slug(args.subject_id ?? args.order_id ?? to)}.html`
      const path = `${decision.dir.replace(/\/+$/, "")}/${name}`
      try {
        io.mkdir(decision.dir)
        io.writeFile(path, decision.html)
      } catch (e) {
        const reason = `could not write preview to ${path}: ${(e as Error).message}`
        io.log?.("error", `${MARKER} ${reason}`)
        return { record: write({ action: "failed", reason }), delivered: false }
      }
      io.log?.("info", `${MARKER} preview template=${template} file=${path}`)
      // `preview`, never `send`. A file on disk is not an email, and a reconciliation that
      // counted it would pass in development and fail the moment it mattered.
      return {
        record: write({ action: "preview", subject: decision.subject, reason: path }),
        delivered: false,
        previewPath: path,
      }
    }

    case "send": {
      if (!io.send) {
        // Reached `send` with nothing to send through: configuration promised a transport
        // that was never supplied. Distinct from "we chose preview".
        const reason = `EMAIL_TRANSPORT=${decision.via} but no transport was provided to dispatch`
        io.log?.("error", `${MARKER} ${reason}`)
        return { record: write({ action: "misconfigured", reason }), delivered: false }
      }
      try {
        await io.send({ via: decision.via, to: decision.to, subject: decision.subject,
          html: decision.html })
      } catch (e) {
        const reason = `transport ${decision.via} threw: ${(e as Error).message}`
        io.log?.("error",
          `${MARKER} FAILED template=${template} to=${decision.to} reason=${reason} — ` +
          `the customer received NOTHING.`)
        return { record: write({ action: "failed", reason }), delivered: false }
      }
      io.log?.("info", `${MARKER} sent template=${template} via=${decision.via}`)
      return { record: write({ action: "send", subject: decision.subject }), delivered: true }
    }
  }
}
