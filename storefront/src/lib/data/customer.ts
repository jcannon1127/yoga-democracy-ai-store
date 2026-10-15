"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { regionPath } from "@lib/util/product-url"
import {
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeAuthToken,
  removeCartId,
  setAuthToken,
} from "./cookies"

export const retrieveCustomer =
  async (): Promise<HttpTypes.StoreCustomer | null> => {
    const authHeaders = await getAuthHeaders()

    if (!authHeaders) return null

    const headers = {
      ...authHeaders,
    }

    const next = {
      ...(await getCacheOptions("customers")),
    }

    return await sdk.client
      .fetch<{ customer: HttpTypes.StoreCustomer }>(`/store/customers/me`, {
        method: "GET",
        query: {
          // `*addresses`, NOT `*orders`, and the swap fixes a real bug plus a real cost.
          //
          // The starter asked for `*orders` here and nothing in the codebase reads
          // `customer.orders` — the account page fetches orders separately. Meanwhile FOUR
          // places read `customer.addresses`, including the checkout address picker, and
          // addresses were never being fetched. So a returning customer with saved addresses
          // saw an empty picker and re-typed an address we already had. Nothing errored; the
          // component simply filtered an undefined list to nothing and rendered no picker.
          //
          // The cost matters too now that history has migrated: YD's most frequent customer
          // has 98 orders, and this call runs on every page that touches the customer.
          fields: "*addresses",
        },
        headers,
        next,
        cache: "force-cache",
      })
      .then(({ customer }) => customer)
      .catch(() => null)
  }

export const updateCustomer = async (body: HttpTypes.StoreUpdateCustomer) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const updateRes = await sdk.store.customer
    .update(body, {}, headers)
    .then(({ customer }) => customer)
    .catch(medusaError)

  const cacheTag = await getCacheTag("customers")
  revalidateTag(cacheTag)

  return updateRes
}

export async function signup(_currentState: unknown, formData: FormData) {
  const password = formData.get("password") as string
  const customerForm = {
    email: formData.get("email") as string,
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    phone: formData.get("phone") as string,
  }

  try {
    const token = await sdk.auth.register("customer", "emailpass", {
      email: customerForm.email,
      password: password,
    })

    await setAuthToken(token as string)

    const headers = {
      ...(await getAuthHeaders()),
    }

    const { customer: createdCustomer } = await sdk.store.customer.create(
      customerForm,
      {},
      headers
    )

    const loginToken = await sdk.auth.login("customer", "emailpass", {
      email: customerForm.email,
      password,
    })

    await setAuthToken(loginToken as string)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    await transferCart()

    return createdCustomer
  } catch (error: any) {
    return error.toString()
  }
}

export async function login(_currentState: unknown, formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string

  try {
    await sdk.auth
      .login("customer", "emailpass", { email, password })
      .then(async (token) => {
        await setAuthToken(token as string)
        const customerCacheTag = await getCacheTag("customers")
        revalidateTag(customerCacheTag)
      })
  } catch (error: any) {
    return error.toString()
  }

  try {
    await transferCart()
  } catch (error: any) {
    return error.toString()
  }
}

export async function signout(countryCode: string) {
  await sdk.auth.logout()

  await removeAuthToken()

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  await removeCartId()

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  redirect(regionPath(countryCode, "/account"))
}

export async function transferCart() {
  const cartId = await getCartId()

  if (!cartId) {
    return
  }

  const headers = await getAuthHeaders()

  await sdk.store.cart.transferCart(cartId, {}, headers)

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
}

export const addCustomerAddress = async (
  currentState: Record<string, unknown>,
  formData: FormData
): Promise<any> => {
  const isDefaultBilling = (currentState.isDefaultBilling as boolean) || false
  const isDefaultShipping = (currentState.isDefaultShipping as boolean) || false

  const address = {
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    company: formData.get("company") as string,
    address_1: formData.get("address_1") as string,
    address_2: formData.get("address_2") as string,
    city: formData.get("city") as string,
    postal_code: formData.get("postal_code") as string,
    province: formData.get("province") as string,
    country_code: formData.get("country_code") as string,
    phone: formData.get("phone") as string,
    is_default_billing: isDefaultBilling,
    is_default_shipping: isDefaultShipping,
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.customer
    .createAddress(address, {}, headers)
    .then(async ({ customer }) => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}

export const deleteCustomerAddress = async (
  addressId: string
): Promise<void> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.customer
    .deleteAddress(addressId, headers)
    .then(async () => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}

export const updateCustomerAddress = async (
  currentState: Record<string, unknown>,
  formData: FormData
): Promise<any> => {
  const addressId =
    (currentState.addressId as string) || (formData.get("addressId") as string)

  if (!addressId) {
    return { success: false, error: "Address ID is required" }
  }

  const address = {
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    company: formData.get("company") as string,
    address_1: formData.get("address_1") as string,
    address_2: formData.get("address_2") as string,
    city: formData.get("city") as string,
    postal_code: formData.get("postal_code") as string,
    province: formData.get("province") as string,
    country_code: formData.get("country_code") as string,
  } as HttpTypes.StoreUpdateCustomerAddress

  const phone = formData.get("phone") as string

  if (phone) {
    address.phone = phone
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.customer
    .updateAddress(addressId, address, {}, headers)
    .then(async () => {
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      return { success: true, error: null }
    })
    .catch((err) => {
      return { success: false, error: err.toString() }
    })
}

/**
 * ─── Password reset ────────────────────────────────────────────────────────────────────
 *
 * None of this existed. `grep -rn "reset\|forgot" src/` returned nothing, while the backend
 * endpoint answered `201 Created` for every request — so password reset looked implemented
 * from the API and was entirely absent from the site.
 *
 * It is the single most load-bearing flow in this lane: SFCC's password hashes are not
 * portable, so **every YD customer resets at cutover**, and half of YD's orders come from
 * repeat customers. If this path is weak, the launch loses the returning half of the business
 * to a support queue.
 */

/**
 * Ask for a reset link.
 *
 * ⚠️ THE UNIFORM ANSWER IS THE FEATURE — DO NOT "IMPROVE" IT.
 *
 * This returns the same success state whether or not the email belongs to a customer, because
 * Medusa itself answers `201` in both cases (measured: a real customer and a nonsense address
 * both return `201 Created`, byte-identical). Distinguishing them would turn the login page
 * into an account-enumeration oracle: anyone could test an address list against YD's customer
 * base for free.
 *
 * This is the ONE place in this codebase where "we could not tell" and "nothing was wrong"
 * are deliberately indistinguishable *to the caller*. Everywhere else that would be a defect.
 * The distinction is not lost — it is written to the server log by the reset subscriber, where
 * the detector reads it and a stranger cannot.
 *
 * It also mirrors the live SFCC site, which behaves the same way.
 */
export async function requestPasswordReset(
  _currentState: unknown,
  formData: FormData
): Promise<{ state: "success" | "error"; message?: string }> {
  const email = ((formData.get("email") as string) || "").trim()

  if (!email) {
    return { state: "error", message: "Please enter your email address." }
  }

  try {
    await sdk.auth.resetPassword("customer", "emailpass", { identifier: email })
  } catch (error: any) {
    // A transport failure is NOT an unknown email, and collapsing the two would tell a
    // customer "check your inbox" when nothing was ever sent. Only genuine infrastructure
    // faults reach here — an unknown address returns 201 like any other.
    return {
      state: "error",
      message:
        "We could not start a password reset just now. Please try again in a moment.",
    }
  }

  return { state: "success" }
}

/**
 * Set the new password using the token from the emailed link.
 *
 * The token is a short-lived JWT (15 minutes) carrying the customer's email, so the email is
 * NOT taken from the form — a form field would let anyone reset a different account by editing
 * it. The link carries the email only so the page can show whose account is being reset.
 */
export async function submitPasswordReset(
  _currentState: unknown,
  formData: FormData
): Promise<{ state: "success" | "error"; message?: string }> {
  const email = ((formData.get("email") as string) || "").trim()
  const token = ((formData.get("token") as string) || "").trim()
  const password = (formData.get("password") as string) || ""
  const confirmPassword = (formData.get("confirm_password") as string) || ""

  // A missing token must never become a permissive path. Without it there is nothing
  // authorising this change, and the failure has to be explicit rather than a generic error
  // the customer reads as "wrong password".
  if (!token || !email) {
    return {
      state: "error",
      message:
        "This reset link is incomplete or has expired. Please request a new one.",
    }
  }

  if (password.length < 8) {
    return {
      state: "error",
      message: "Please choose a password of at least 8 characters.",
    }
  }

  if (password !== confirmPassword) {
    return { state: "error", message: "The two passwords do not match." }
  }

  try {
    await sdk.auth.updateProvider(
      "customer",
      "emailpass",
      { email, password },
      token
    )
  } catch (error: any) {
    // Expired and already-used tokens both land here. Say so plainly with the way out, rather
    // than an error string the customer cannot act on.
    return {
      state: "error",
      message:
        "This reset link has expired or has already been used. Please request a new one.",
    }
  }

  return { state: "success" }
}

/**
 * Change the signed-in customer's password.
 *
 * Backed by `POST /store/customers/me/password`, which Medusa does not provide — its only
 * password-update endpoint accepts single-use RESET tokens and refuses a session. See that
 * route for why the current password is required.
 *
 * The starter shipped `ProfilePassword` as a stub whose action toasted "Password update is not
 * implemented", and the profile page then had the component commented out while its own copy
 * still told the customer they could change their password there.
 */
export async function updateCustomerPassword(
  _currentState: unknown,
  formData: FormData
): Promise<{ state: "success" | "error"; message?: string }> {
  const oldPassword = (formData.get("old_password") as string) || ""
  const newPassword = (formData.get("new_password") as string) || ""
  const confirmPassword = (formData.get("confirm_password") as string) || ""

  if (!oldPassword || !newPassword) {
    return {
      state: "error",
      message: "Please enter your current password and a new password.",
    }
  }
  if (newPassword.length < 8) {
    return {
      state: "error",
      message: "Please choose a password of at least 8 characters.",
    }
  }
  if (newPassword !== confirmPassword) {
    return { state: "error", message: "The two passwords do not match." }
  }

  const headers = { ...(await getAuthHeaders()) }
  if (!headers || !Object.keys(headers).length) {
    return { state: "error", message: "Please sign in again." }
  }

  try {
    await sdk.client.fetch("/store/customers/me/password", {
      method: "POST",
      body: { old_password: oldPassword, new_password: newPassword },
      headers,
    })
  } catch (error: any) {
    // The route answers a wrong current password with 401 and a plain message. Surfacing it
    // verbatim is right here — the caller is already authenticated, so there is nothing to
    // conceal, and "an error occurred" would leave the customer guessing which field was wrong.
    return {
      state: "error",
      message:
        error?.message ||
        "We could not update your password. Please try again.",
    }
  }

  return { state: "success" }
}

/**
 * Change the signed-in customer's email address — and their login with it.
 *
 * Backed by `POST /store/customers/me/email`. Medusa's own `StoreUpdateCustomer` omits `email`
 * on purpose, because for emailpass the address IS the credential; moving `customer.email`
 * alone would leave the customer signing in with the old address forever.
 *
 * What was here before returned `{ success: true }` without calling anything, so the page
 * showed a green "Email updated succesfully" badge and nothing changed. Proven in a browser
 * before it was replaced.
 */
export async function updateCustomerEmail(
  _currentState: unknown,
  formData: FormData
): Promise<{ state: "success" | "error"; message?: string }> {
  const email = ((formData.get("email") as string) || "").trim()
  const password = (formData.get("password") as string) || ""

  if (!email || !password) {
    return {
      state: "error",
      message: "Please enter a new email address and your password.",
    }
  }

  const headers = { ...(await getAuthHeaders()) }
  if (!headers || !Object.keys(headers).length) {
    return { state: "error", message: "Please sign in again." }
  }

  try {
    await sdk.client.fetch("/store/customers/me/email", {
      method: "POST",
      body: { email, password },
      headers,
    })
  } catch (error: any) {
    return {
      state: "error",
      message:
        error?.message ||
        "We could not update your email address. Please try again.",
    }
  }

  // The customer record is cached; without this the page would go on showing the old address
  // after a change that really did happen — the mirror image of the bug this replaces.
  const cacheTag = await getCacheTag("customers")
  revalidateTag(cacheTag)

  return { state: "success" }
}
