import { retrieveCustomer } from "@lib/data/customer"
import { Toaster } from "@medusajs/ui"
import AccountLayout from "@modules/account/templates/account-layout"

/**
 * Wraps the account area. Renders `children` directly — the parallel-route slots this used
 * to switch between are gone; see page.tsx for why.
 */
export default async function AccountPageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const customer = await retrieveCustomer().catch(() => null)

  return (
    <AccountLayout customer={customer}>
      {children}
      <Toaster />
    </AccountLayout>
  )
}
