/**
 * The real filesystem behind `DispatchIo`. Kept in its own file so that everything with a
 * decision in it stays testable without touching a disk.
 *
 * `appendFileSync` is a single `O_APPEND` write, which is what the send log's crash-safety
 * rests on: a torn write truncates the last line rather than corrupting earlier ones, and two
 * processes appending cannot interleave a record.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import type { DispatchIo } from "./dispatch.ts"

export function nodeIo(log?: (level: "info" | "error", message: string) => void): DispatchIo {
  return {
    now: () => new Date().toISOString(),
    mkdir: (dir) => { mkdirSync(dir, { recursive: true }) },
    writeFile: (path, contents) => { writeFileSync(path, contents, "utf8") },
    appendFile: (path, contents) => { appendFileSync(path, contents, "utf8") },
    log,
  }
}
