import { Metadata } from "next"
import ResetPassword from "@modules/account/components/reset-password"
import { STORE_NAME } from "@lib/constants/store"

export const metadata: Metadata = {
  title: "Set a new password",
  description: `Set a new password for your ${STORE_NAME} account.`,
  robots: { index: false, follow: false },
}

/**
 * The destination of the emailed reset link: /account/reset-password?token=…&email=…
 *
 * `noindex` matters here beyond the usual preview reason — a reset URL carries a live
 * credential in the query string, and an indexed one is a credential in a search result.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>
}) {
  const { token, email } = await searchParams

  return (
    <div className="w-full flex justify-start px-8 py-8">
      <ResetPassword token={token ?? ""} email={email ?? ""} />
    </div>
  )
}
