import { test } from "node:test"
import assert from "node:assert/strict"
import { formatDay, isRealDate } from "./dates.ts"

test("A BARE YYYY-MM-DD IS THAT CALENDAR DAY, NOT MIDNIGHT UTC — which in ET is the day before", () => {
  // The whole point: Date.parse("2026-09-01") is midnight UTC = 8pm Aug 31 in Eastern time,
  // so a configured deadline used to be rendered to the customer one day early.
  assert.equal(new Date(Date.parse("2026-09-01")).toISOString(), "2026-09-01T00:00:00.000Z")
  assert.equal(formatDay("2026-09-01"), "September 1")
  assert.equal(formatDay("2026-01-01"), "January 1")
  assert.equal(formatDay("2026-12-31", { year: true }), "December 31, 2026")
})

test("a timestamp that carries a time is taken at its word, in Eastern time", () => {
  // 00:30 UTC on the 1st is 8:30pm on August 31 in ET, and that is the honest answer.
  assert.equal(formatDay("2026-09-01T00:30:00Z"), "August 31")
  assert.equal(formatDay("2026-09-01T16:00:00Z"), "September 1")
})

test("the formatter does not follow the server's clock", () => {
  const before = process.env.TZ
  try {
    process.env.TZ = "Asia/Tokyo"
    assert.equal(formatDay("2026-09-01T16:00:00Z"), "September 1")
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
})

test("AN UNPARSEABLE DATE IS null, NEVER TODAY AND NEVER A GUESS", () => {
  // "2026-13-45" is the one that mattered: Date.UTC rolls it over into February 2027.
  for (const v of [undefined, null, "", "  ", "not a date", "2026-13-45", "2026-02-30",
    "2026-00-10", "2026-01-00", new Date("nope")]) {
    assert.equal(formatDay(v as never), null, JSON.stringify(String(v)))
    assert.equal(isRealDate(v as never), false)
  }
})

test("isRealDate and formatDay agree — one rule, one implementation", () => {
  for (const v of ["2026-09-01", "2026-09-01T16:00:00Z", "not a date", "", undefined]) {
    assert.equal(isRealDate(v as never), formatDay(v as never) !== null, String(v))
  }
})

test("a Date object is accepted directly", () => {
  assert.equal(formatDay(new Date("2026-09-01T16:00:00Z")), "September 1")
})
