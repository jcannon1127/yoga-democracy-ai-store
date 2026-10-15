/**
 * WHICH MEDUSA EVENT DRIVES WHICH EMAIL — and the check that makes a wrong name loud.
 *
 * **This lane parked with the subscribers deliberately unbuilt, for one stated reason: a
 * subscriber registered on an event name nothing emits is silent by nature.** No error, no
 * log line, no failing test — the emails simply never send, and every other part of the
 * system looks healthy. Guessing the name was the risk, so the name was not guessed.
 *
 * **That reason is now gone, and this file is why.** Every entry below was read out of the
 * Medusa 2.19.0 packages actually installed on this machine — the constant AND the workflow
 * that emits it AND the payload it carries. `emittedBy` records where, so the next person
 * can re-check rather than re-trust.
 *
 * ── THREE THINGS THE SOURCE SAID THAT I HAD WRONG OR WOULD HAVE GOT WRONG ───────────────
 *
 * 1. **The shipment notice fires on `shipment.created`, NOT `order.fulfillment_created`.**
 *    They are different moments. `order.fulfillment_created` fires when the warehouse
 *    creates the fulfillment — items picked, **no label, no tracking number yet**.
 *    `shipment.created` fires from `createShipmentWorkflow`, which is what attaches
 *    `labels[]` and stamps `shipped_at`.
 *    **Wiring the wrong one of these is worse than wiring a name that does not exist.** A
 *    name that does not exist is at least inert. `order.fulfillment_created` DOES fire, so
 *    the subscriber runs, renders — and `renderShipmentNotice` correctly returns null for a
 *    missing tracking number, so every single one is logged as a legitimate
 *    `skip: no tracking number`. **A shipment notice that never sends, with a clean reason
 *    on every one, and a reconciliation that agrees nothing is wrong.**
 *
 * 2. **Both fulfillment events carry `no_notification` — the admin's explicit "do not email
 *    this customer".** Ignoring it means overriding a human who deliberately said no. See
 *    `decideNotify` for why reading it is less obvious than `if (data.no_notification)`.
 *
 * 3. **`order.placed` also fires when an admin converts a DRAFT ORDER**
 *    (`convert-draft-order.js`), not only from `complete-cart.js`. So a phone or wholesale
 *    order typed in by staff sends the customer a normal order confirmation. That is
 *    probably right for YD, but it is a decision, and it was about to be made by accident.
 *
 * ── AND THE PAYLOADS ARE THINNER THAN THEY LOOK ──────────────────────────────────────────
 * `order.placed` carries `{ id }` — the order id and nothing else.
 * `shipment.created` carries `{ id, no_notification }` where **`id` is a FULFILLMENT id, not
 * an order id and not a separate shipment record.** There is no order id in the payload at
 * all; the subscriber has to look it up. Anything that assumed `data.order_id` would read
 * `undefined` and go looking for an order called "undefined".
 */

export type ConstantGroup =
  | "OrderWorkflowEvents"
  | "FulfillmentWorkflowEvents"
  | "AuthWorkflowEvents"
  | "CustomerWorkflowEvents"

export type EventWiring = {
  /** The event name a subscriber registers on. */
  event: string
  /** Which template in `registry.ts` it drives, or null when nothing is wired yet. */
  template: string | null
  /** The group and key in Medusa's own exported constants this must equal. */
  constant: { group: ConstantGroup; key: string }
  /** The payload, as read from the emitting workflow. */
  payload: string
  /** Where it is emitted in the installed packages. Re-checkable, not remembered. */
  emittedBy: string
  /** Whether the payload carries the admin's suppression flag. */
  carriesNoNotification: boolean
  /** Why this event and not a neighbouring one. */
  note?: string
}

export const WIRING: EventWiring[] = [
  {
    event: "order.placed",
    template: "order-confirmation",
    constant: { group: "OrderWorkflowEvents", key: "PLACED" },
    payload: "{ id }  // order id only",
    emittedBy:
      "@medusajs/core-flows cart/workflows/complete-cart.js:535 " +
      "and draft-order/workflows/convert-draft-order.js:132",
    carriesNoNotification: false,
    note:
      "Emitted at EventPriority.CRITICAL from both places. The draft-order path means an " +
      "admin-typed order also confirms to the customer.",
  },
  {
    event: "shipment.created",
    template: "shipment-notice",
    constant: { group: "FulfillmentWorkflowEvents", key: "SHIPMENT_CREATED" },
    payload: "{ id, no_notification }  // id is a FULFILLMENT id",
    emittedBy: "@medusajs/core-flows order/workflows/create-shipment.js:154",
    carriesNoNotification: true,
    note:
      "NOT order.fulfillment_created — that fires at pick time with no label attached, and " +
      "would produce a permanent, clean-looking 'skip: no tracking number' on every order.",
  },
  {
    event: "auth.password_reset",
    template: "password-reset",
    constant: { group: "AuthWorkflowEvents", key: "PASSWORD_RESET" },
    payload: "{ entity_id, actor_type, token, metadata? }",
    emittedBy: "emitted by the auth module on reset request; handled in src/subscribers/auth-password-reset.ts",
    carriesNoNotification: false,
    note:
      "Already wired by yd-accounts. Listed here so the name is checked with the others " +
      "rather than being the one nobody re-verifies.",
  },
]

/**
 * Templates that are deliberately NOT event-driven, and why. Listed so that "no subscriber"
 * reads as a decision rather than as an oversight nobody noticed.
 */
export const NOT_EVENT_DRIVEN: Record<string, string> = {
  welcome:
    "Fires on list subscription, not on a Medusa domain event. Blocked on Klaviyo credentials.",
  "abandoned-cart":
    "A journey on a timer, not an event — steps 2 and 3 are 'still abandoned N hours later', " +
    "which no single event can express. BUILT as a scheduled job: src/jobs/abandoned-cart.ts, " +
    "with the selection in modules/email/abandoned-cart-journey.ts. Off unless " +
    "ABANDONED_CART_ENABLED=true.",
  "gift-certificate":
    "Rides on order.placed, but per CERTIFICATE rather than per order — see reconcileSubjects. " +
    "Left unwired until parity is confirmed by a real test send.",
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The check that stops a renamed event from being silent
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Shape of `@medusajs/utils`' event-name exports: group name -> { KEY: "event.name" }. */
export type MedusaEventConstants = Record<string, Record<string, string> | undefined>

export type EventNameCheck =
  | { state: "ok"; checked: number; source: string }
  | { state: "mismatch"; problems: string[]; source: string }
  | { state: "undetermined"; detail: string }

/**
 * Compare every wired event name against Medusa's own exported constants.
 *
 * **This is a structural check, not a measurement — deliberately.** It has no threshold and
 * no yardstick to calibrate: either our string equals the string Medusa itself emits, or it
 * does not. Nothing about it can drift.
 *
 * **It returns `undetermined` — never `ok` — when the constants cannot be read.** That is
 * the whole point. A check that quietly passes because it could not find what it was
 * checking against is the failure mode this lane keeps hitting under new costumes: an inert
 * green light. If `@medusajs/utils` is not resolvable (a worktree with no `node_modules`,
 * for instance) the honest answer is "nobody verified this", and it must not be mistaken for
 * "verified".
 */
export function checkEventNames(
  constants: MedusaEventConstants | undefined,
  source: string,
  wiring: EventWiring[] = WIRING
): EventNameCheck {
  if (!constants || typeof constants !== "object") {
    return {
      state: "undetermined",
      detail:
        `could not read Medusa's event constants from ${source} — the wired event names are ` +
        `UNVERIFIED. This is not a pass.`,
    }
  }

  const problems: string[] = []
  for (const w of wiring) {
    const group = constants[w.constant.group]
    if (!group || typeof group !== "object") {
      problems.push(
        `${w.event}: Medusa exports no group "${w.constant.group}" — it has been renamed or ` +
          `moved, so nothing is listening for ${w.template ?? "this event"}.`
      )
      continue
    }
    const actual = group[w.constant.key]
    if (actual === undefined) {
      problems.push(
        `${w.event}: ${w.constant.group}.${w.constant.key} no longer exists. ` +
          `${w.template ?? "This template"} will never send.`
      )
      continue
    }
    if (actual !== w.event) {
      problems.push(
        `${w.event}: Medusa now emits "${actual}" for ${w.constant.group}.${w.constant.key}. ` +
          `A subscriber on the old name is silent — it does not error, it simply never runs.`
      )
    }
  }

  return problems.length
    ? { state: "mismatch", problems, source }
    : { state: "ok", checked: wiring.length, source }
}

/**
 * Every wired template id must exist in the registry, and every registry id must be either
 * wired or explicitly listed as not event-driven.
 *
 * **The second half is the half that matters.** A template nobody dispatches is exactly as
 * useless as a subscriber on a wrong event name, and just as quiet — it renders in tests, it
 * passes review, and no customer ever receives it. Forcing every id to be either wired or
 * named in `NOT_EVENT_DRIVEN` means an unsent template has to be an admission.
 */
export function checkTemplateCoverage(registryIds: string[]): {
  state: "ok" | "gaps"
  problems: string[]
} {
  const problems: string[] = []
  const wired = new Set(WIRING.map((w) => w.template).filter(Boolean) as string[])

  for (const id of wired) {
    if (!registryIds.includes(id)) {
      problems.push(`${id} is wired to an event but is not a known template — render() will throw.`)
    }
  }
  for (const id of registryIds) {
    if (!wired.has(id) && !(id in NOT_EVENT_DRIVEN)) {
      problems.push(
        `${id} is a built template that nothing dispatches and nothing has excused. ` +
          `Wire it, or say in NOT_EVENT_DRIVEN why it is not event-driven.`
      )
    }
  }
  return problems.length ? { state: "gaps", problems } : { state: "ok", problems: [] }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The admin's "do not notify this customer"
// ─────────────────────────────────────────────────────────────────────────────────────────

export type NotifyDecision = {
  notify: boolean
  state: "notify" | "suppressed" | "unclear"
  detail?: string
}

/**
 * Read `no_notification` off a fulfillment event payload.
 *
 * **`if (data.no_notification)` is wrong, and wrong in the direction that silences email.**
 * Events cross a bus and are serialised; a payload arriving as `{"no_notification":"false"}`
 * is entirely possible, and the string `"false"` is truthy. That one line would suppress the
 * shipment notice for every order while looking like it was honouring an admin's choice —
 * and the reconciliation would read the resulting `skip` records as deliberate.
 *
 * So the flag has three readings, not two:
 *   - absent, null, or `false`  -> notify. Medusa's own default is no suppression.
 *   - exactly `true`            -> suppressed. A human said so; obey it.
 *   - anything else             -> **unclear: notify anyway, and say so loudly.**
 *
 * **The unclear branch resolves toward sending, and that is a judgement, not an oversight.**
 * An unwanted tracking email is a redundancy the customer ignores. A missing one is a
 * customer with no tracking number and a support ticket. Given a value neither side can
 * interpret, the cheaper mistake is the one that still delivers — but it must not be
 * invisible, because an unparseable flag is a wiring fault somebody has to fix.
 */
export function decideNotify(payload: unknown): NotifyDecision {
  const v = (payload as { no_notification?: unknown } | null | undefined)?.no_notification

  if (v === undefined || v === null || v === false) return { notify: true, state: "notify" }
  if (v === true) {
    return {
      notify: false,
      state: "suppressed",
      detail: "no_notification=true — an admin explicitly asked for no customer email",
    }
  }
  return {
    notify: true,
    state: "unclear",
    detail:
      `no_notification=${JSON.stringify(v)} is neither true nor false (${typeof v}) — sending ` +
      `anyway, because a missing tracking email costs more than a redundant one. FIX THE ` +
      `PAYLOAD: a truthiness test here would have suppressed on the string "false".`,
  }
}
