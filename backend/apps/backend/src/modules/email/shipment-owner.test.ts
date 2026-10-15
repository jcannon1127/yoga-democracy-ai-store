import { test } from "node:test"
import assert from "node:assert/strict"
import { shipmentOwner } from "./shipment-owner.ts"

test("UNSET REFUSES — the default at cutover is two emails per parcel, and nothing errors", () => {
  const r = shipmentOwner({})
  assert.equal(r.state, "undeclared")
  assert.match(r.detail, /TWO emails per parcel/)
  assert.match(r.detail, /tracking@shipstation\.com/, "the evidence travels with the refusal")
})

test("medusa means we send, and says what must be turned off", () => {
  const r = shipmentOwner({ SHIPMENT_NOTICE_OWNER: "medusa" })
  assert.equal(r.state, "ours")
  assert.match(r.detail, /ShipStation's own notification must be turned OFF/)
})

test("shipstation means we send nothing, and carries the reconciliation consequence", () => {
  const r = shipmentOwner({ SHIPMENT_NOTICE_OWNER: "shipstation" })
  assert.equal(r.state, "shipstation")
  assert.match(r.detail, /report every order as un-emailed/)
})

test("a value that is neither refuses rather than picking one", () => {
  for (const v of ["yes", "true", "sfmc", "both", " ", "MEDUSA "]) {
    const r = shipmentOwner({ SHIPMENT_NOTICE_OWNER: v })
    if (v.trim().toLowerCase() === "medusa") { assert.equal(r.state, "ours"); continue }
    assert.equal(r.state, "undeclared", JSON.stringify(v))
  }
})

test("the declaration is case- and whitespace-insensitive, because it is typed by a human", () => {
  assert.equal(shipmentOwner({ SHIPMENT_NOTICE_OWNER: "  Medusa " }).state, "ours")
  assert.equal(shipmentOwner({ SHIPMENT_NOTICE_OWNER: "ShipStation" }).state, "shipstation")
})
