/**
 * Package entry point.
 *
 * Medusa resolves a payment provider by requiring the package `main` and reading
 * `services` off the default export. Upstream's barrel re-exported only types, so
 * `main` resolved perfectly and exported nothing usable — Medusa then died with
 * `moduleProviderServices is not iterable` during module load, before the server
 * existed, and systemd restart-looped.
 *
 * That took the store down for six minutes on 2026-08-24. The package must be
 * correct rather than the config compensating with a deep path, so the provider
 * is re-exported as the default here.
 *
 * NOTE: `require()` succeeding proves resolvability, NOT loadability. The cheap
 * check that catches this is in SOURCE.md.
 */
export { default } from "./providers/paypal";
export { PAYPAL_MODULE } from "./providers/paypal";
export * from "./types";
