/**
 * The send log — what the reconciliation actually reads.
 *
 * **Without this the reconciliation is a function with no input.** It can name the orders that
 * have no send, but only if something recorded the sends; until now that side of the
 * comparison did not exist, which is the same "green but inert" shape in a new costume.
 *
 * One JSON object per line. Append-only, so a crash truncates the last line rather than
 * corrupting the file, and so two processes appending cannot interleave a record.
 *
 * **The reader distinguishes THREE states and the middle one is the point:**
 *   `ok`         — read it; `records` is what happened.
 *   `missing`    — no log file. **This is NOT "no sends".** It is "we cannot tell", and it is
 *                  exactly how this detector would report a clean bill of health while the
 *                  transport was never wired at all.
 *   `unreadable` — present and unusable. A wiring fault, and loud.
 *
 * **Malformed lines are COUNTED, never silently skipped.** A parser that quietly drops what it
 * cannot read turns a corrupted log into a confident list of missing sends — inventing a
 * failure — or, on the other side of a comparison, hides one.
 */

export type SendRecord = {
  /** ISO 8601, UTC. */
  at: string
  template: string
  to: string
  /** Present for order-scoped mail. Reconciliation joins on this for one-per-order email. */
  order_id?: string
  /**
   * The specific thing this send is about, when an order can need MORE THAN ONE of them.
   *
   * **A gift-certificate order can contain several certificates, each going to a different
   * recipient.** Reconciling per order would pass with one send while three people got
   * nothing — the same shape as one shipment notice for a three-parcel order. So gift
   * certificates join on this, not on `order_id`.
   */
  subject_id?: string
  subject?: string
  /**
   * What actually happened — mirrors the delivery decision, not just "sent".
   *
   * **`failed` is its own state and must never be folded into a neighbour.** A transport
   * that threw is not `send` (nothing arrived), not `skip` (nothing was deliberate) and not
   * `misconfigured` (the settings may be perfect and the network down). It still proves the
   * logger was running, so it counts toward coverage — and `deliveredSends` still excludes
   * it, so it can never satisfy a reconciliation.
   */
  action: "preview" | "send" | "skip" | "blocked" | "misconfigured" | "failed"
  reason?: string
}

export type SendLog =
  | { state: "ok"; records: SendRecord[]; malformed: number }
  | { state: "missing"; detail: string }
  | { state: "unreadable"; detail: string }

/** Serialise one record. Newline-terminated; never emits an embedded newline. */
export function formatRecord(r: SendRecord): string {
  return JSON.stringify(r) + "\n"
}

export function parseSendLog(text: string): { records: SendRecord[]; malformed: number } {
  const records: SendRecord[] = []
  let malformed = 0
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t)
      // A record missing the fields reconciliation joins on is malformed, not usable.
      if (o && typeof o.template === "string" && typeof o.action === "string" &&
          typeof o.at === "string") {
        records.push(o as SendRecord)
      } else {
        malformed++
      }
    } catch {
      malformed++
    }
  }
  return { records, malformed }
}

export type FsLike = {
  existsSync: (p: string) => boolean
  readFileSync: (p: string, enc: "utf8") => string
}

export function readSendLog(path: string, fs: FsLike): SendLog {
  if (!path?.trim()) {
    return { state: "unreadable", detail: "no send log path configured" }
  }
  if (!fs.existsSync(path)) {
    // The single most important branch in this file.
    return { state: "missing",
      detail: `no send log at ${path} — nothing has been recorded, which is NOT the same as ` +
        `nothing having been sent. Cannot reconcile.` }
  }
  try {
    const { records, malformed } = parseSendLog(fs.readFileSync(path, "utf8"))
    return { state: "ok", records, malformed }
  } catch (e) {
    return { state: "unreadable", detail: `${path}: ${(e as Error).message}` }
  }
}

/**
 * Records where a transport ACCEPTED the message — which is not the same as it arriving, and
 * the difference is stated here because it is the one thing this log cannot prove.
 *
 * **`send` means "handed to a transport and it did not throw". It does not mean delivered.**
 * A hard bounce arrives minutes later, out of band, and nothing here ever hears about it. So a
 * reconciliation built on this answers *"did we try?"*, not *"did it arrive?"* — and reading it
 * as the second is the same mistake yd-accounts found in its own reset detector, which counted
 * every imported customer as reachable because a link could be GENERATED.
 *
 * **The one class this DOES now exclude is the address that could never have arrived**:
 * `classifyRecipient` refuses RFC 2606/6761 reserved addresses before any transport sees them,
 * so `anonymous-<n>@example.com` is recorded `blocked`, never `send`. **Structural
 * undeliverability is caught; a dead-but-well-formed mailbox is not, and only a real send and
 * a bounce handler will ever catch that.**
 *
 * **`skip` and `blocked` and `misconfigured` are not sends**, and `preview` is not either — a
 * file on disk is not an email. Counting previews would make the reconciliation pass in
 * development and fail the moment it mattered, which is the wrong way round.
 */
export function deliveredSends(records: SendRecord[]): SendRecord[] {
  return records.filter((r) => r.action === "send")
}
