import { Metadata } from "next"
import GuestOrderLookup from "@modules/order/components/guest-order-lookup"
import { STORE_NAME } from "@lib/constants/store"

export const metadata: Metadata = {
  title: "Track your order",
  description: `Look up a ${STORE_NAME} order with your order number and email address.`,
}

export default function TrackOrderPage() {
  return (
    <div className="w-full flex justify-center px-8 py-12">
      <GuestOrderLookup />
    </div>
  )
}
