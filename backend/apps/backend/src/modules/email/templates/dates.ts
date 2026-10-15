/**
 * How this lane writes a date a customer is asked to act on.
 *
 * **Two rules, both of which have already bitten something in this project.**
 *
 * 1. **Eastern time, always.** YD is an Eastern-time business and every report, timestamp and
 *    deadline in this workspace is ET. A formatter with no `timeZone` follows the server's,
 *    which is a property of where the process happens to run.
 *
 * 2. **A date with no time means that calendar day, not midnight UTC.** This is the one that
 *    is easy to miss and lands on a customer. Somebody configuring an offer writes
 *    `2026-09-01`. `Date.parse` reads a bare `YYYY-MM-DD` as **midnight UTC**, which in
 *    Eastern time is 8pm on **August 31** — so the email says the discount expires a day
 *    earlier than anyone intended. Nothing errors, the date is real, and it is wrong by one
 *    day on a deadline. A timestamp that carries a time is taken at its word.
 *
 * **An unparseable date is `null`, never today and never a guess.** Callers must render
 * nothing rather than a made-up deadline — the rule a surviving mutation established when the
 * gift certificate said "spend it whenever you like" and "use it by January 15" in one email.
 */
const ET = "America/New_York"

/** True only for a value that yields a real calendar day. */
export function isRealDate(value: string | Date | undefined | null): boolean {
  return formatDay(value) !== null
}

export function formatDay(
  value: string | Date | undefined | null,
  opts: { year?: boolean } = {}
): string | null {
  if (value === undefined || value === null || value === "") return null

  let d: Date
  if (value instanceof Date) {
    d = value
  } else {
    const t = value.trim()
    // A bare calendar date means that day where the reader is, not an instant in UTC.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
    if (dateOnly) {
      const [, y, m, day] = dateOnly
      const built = new Date(Date.UTC(Number(y), Number(m) - 1, Number(day), 12))
      // **`Date.UTC` ROLLS OVER, so an impossible date becomes a confident real one:**
      // `2026-13-45` builds cleanly and lands in February 2027 — a deadline months away that
      // nobody typed and nothing errors on. Only a value that survives the round trip is a
      // date; anything else is null, like any other unparseable input.
      if (built.getUTCFullYear() !== Number(y) || built.getUTCMonth() !== Number(m) - 1 ||
          built.getUTCDate() !== Number(day)) {
        return null
      }
      return label(built, opts, "UTC")
    }
    d = new Date(t)
  }
  if (Number.isNaN(d.getTime())) return null
  return label(d, opts, ET)
}

function label(d: Date, opts: { year?: boolean }, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, month: "long", day: "numeric", ...(opts.year ? { year: "numeric" } : {}),
  }).format(d)
}
