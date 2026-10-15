"use client"

import { useRouter, useParams } from "next/navigation"
import { useState } from "react"

import { regionPath } from "@lib/util/product-url"

/**
 * The search input. Submits to /search — a real page, not a modal, so a result set can be
 * linked, shared and gone back to.
 */
export default function SearchBox({
  initialQuery = "",
  autoFocus = false,
  onSubmitted,
}: {
  initialQuery?: string
  autoFocus?: boolean
  onSubmitted?: () => void
}) {
  const [value, setValue] = useState(initialQuery)
  const router = useRouter()
  const { countryCode } = useParams()

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        const q = value.trim()
        if (!q) return
        onSubmitted?.()
        router.push(
          `${regionPath(String(countryCode), "/search")}?q=${encodeURIComponent(q)}`
        )
      }}
      className="flex items-center gap-x-2 w-full"
    >
      <input
        type="search"
        name="q"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search products, prints and motifs"
        aria-label="Search products"
        className="flex-1 border border-ui-border-base rounded-full px-4 py-2 txt-compact-medium focus:outline-none focus:border-yd-primary"
      />
      <button
        type="submit"
        className="bg-yd-primary text-white rounded-full px-5 py-2 txt-compact-medium hover:opacity-90"
      >
        Search
      </button>
    </form>
  )
}
