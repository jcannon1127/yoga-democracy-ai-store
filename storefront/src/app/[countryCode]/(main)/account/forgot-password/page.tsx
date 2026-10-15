import { Metadata } from "next"
import ForgotPassword from "@modules/account/components/forgot-password"
import { STORE_NAME } from "@lib/constants/store"

export const metadata: Metadata = {
  title: "Reset your password",
  description: `Request a link to set a new ${STORE_NAME} password.`,
  robots: { index: false, follow: false },
}

export default function ForgotPasswordPage() {
  return (
    <div className="w-full flex justify-start px-8 py-8">
      <ForgotPassword />
    </div>
  )
}
