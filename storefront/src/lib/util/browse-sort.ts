/**
 * The sort options a browse page offers, labelled exactly as the live site labels them.
 *
 * This lives apart from the <SortSelect> component on purpose: that component is a client
 * component, and a plain array exported from a "use client" module arrives in a server
 * component as a client-reference proxy, not an array. Reading it server-side threw
 * "BROWSE_SORTS.find is not a function" on every category page.
 *
 * One live option is deliberately absent: "Trending". SFCC computes it from its own activity
 * data, which does not exist here, and a Trending option that silently returned the default
 * order would be a lie in the UI rather than a missing feature. It comes back when there is
 * real behavioural data to sort by.
 */
export type BrowseSort = "featured" | "a-z" | "z-a" | "price-low" | "price-high"

export const BROWSE_SORTS: { value: BrowseSort; label: string }[] = [
  { value: "featured", label: "Best Sellers" },
  { value: "a-z", label: "Alphabetically, A-Z" },
  { value: "z-a", label: "Alphabetically, Z-A" },
  { value: "price-low", label: "Price, low to high" },
  { value: "price-high", label: "Price, high to low" },
]

export const DEFAULT_BROWSE_SORT: BrowseSort = "featured"

export function resolveBrowseSort(value?: string | null): BrowseSort {
  return BROWSE_SORTS.find((option) => option.value === value)?.value ?? DEFAULT_BROWSE_SORT
}
