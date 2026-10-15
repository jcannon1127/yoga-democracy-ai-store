"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { BROWSE_SORTS, BrowseSort } from "@lib/util/browse-sort"

export default function SortSelect({ sort }: { sort: BrowseSort }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams)
    params.set("sort", value)
    // Re-sorting starts the listing again: keeping "show=120" across a sort change would
    // dump 120 tiles of a completely different order on the customer.
    params.delete("show")
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <select
      aria-label="Sort By"
      // 44px on a phone, the live site's height above it. Measured at a verified 390 the
      // select came out 39px — over WCAG's 24 minimum, under the comfortable 44, and sitting
      // directly beside a 48px Filter button, so it was the odd control out both to a thumb
      // and to the eye. Sort is how a shopper reorders 208 products; it is load-bearing.
      className="w-full min-[768px]:w-auto min-h-[44px] min-[768px]:min-h-0 border border-ui-border-base rounded-none px-3 py-2 text-base-regular bg-white"
      value={sort}
      onChange={(e) => onChange(e.target.value)}
      data-testid="browse-sort"
    >
      {BROWSE_SORTS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
