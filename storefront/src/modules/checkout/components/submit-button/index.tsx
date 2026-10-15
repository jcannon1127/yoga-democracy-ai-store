"use client"

import { Button } from "@medusajs/ui"
import React from "react"
import { useFormStatus } from "react-dom"

/**
 * The shared form-submit button — account forms, password reset, order tracking, checkout.
 *
 * `min-h-[44px]` because `@medusajs/ui`'s `size="large"` renders 40px, and measured at a
 * verified 390px viewport that is under the 44px touch minimum on every form on the site. It
 * is not a house style: this storefront's own primary call to action, Add to Cart on the PDP,
 * is already 48px. 40px was the library default that nobody had looked at on a phone, not a
 * decision anyone made.
 *
 * Only ever grows the button, and only to the floor — anything already taller is untouched.
 */
export function SubmitButton({
  children,
  variant = "primary",
  className,
  "data-testid": dataTestId,
}: {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "transparent" | "danger" | null
  className?: string
  "data-testid"?: string
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      size="large"
      className={["min-h-[44px]", className].filter(Boolean).join(" ")}
      type="submit"
      isLoading={pending}
      variant={variant || "primary"}
      data-testid={dataTestId}
    >
      {children}
    </Button>
  )
}
