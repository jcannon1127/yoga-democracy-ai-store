import LocalizedClientLink from "@modules/common/components/localized-client-link"
import {
  FacetGroup,
  Selection,
  isSelected,
  paramsFromSelection,
  toggled,
} from "@lib/util/browse-facets"

/**
 * The live site's left-hand refinement bar: Patterns, Type, Size, Length, with a Reset.
 *
 * Every value is a LINK, not a checkbox, for three reasons the live site shares: the filtered
 * URLs are real and indexable, the whole thing works before any JavaScript loads, and it stays
 * a server component. On a phone it collapses into a <details> — a native disclosure needs no
 * script and is reachable by tap, which is the standard this storefront now holds itself to.
 */
export default function RefinementBar({
  basePath,
  groups,
  selection,
  sort,
}: {
  basePath: string
  groups: FacetGroup[]
  selection: Selection
  sort: string
}) {
  if (!groups.length) return null

  const href = (next: Selection) => {
    const params = [paramsFromSelection(next), sort !== "featured" ? `sort=${sort}` : ""]
      .filter(Boolean)
      .join("&")
    // Search's base path already carries the query (`/search?q=octopus`), so the separator
    // has to be chosen rather than assumed — appending "?" unconditionally produced
    // /search?q=octopus?prefn1=color, which silently loses the search term.
    const separator = basePath.includes("?") ? "&" : "?"
    return params ? `${basePath}${separator}${params}` : basePath
  }

  const body = (
    <div className="flex flex-col gap-y-6">
      {/* Reset is always shown, as on the live site, rather than appearing once something is
          selected — a control that materialises changes the layout under the customer's cursor. */}
      <LocalizedClientLink
        href={href([])}
        className="block text-center bg-[#1f3d2b] text-white py-3 text-base-regular hover:opacity-90"
        data-testid="refinement-reset"
      >
        Reset
      </LocalizedClientLink>

      {groups.map((group) => (
        <div
          key={group.id}
          className="border border-ui-border-base"
          data-testid={`refinement-${group.id}`}
        >
          <h3 className="txt-compact-medium-plus px-4 py-3 border-b border-ui-border-base">
            {group.label}
          </h3>
          <ul className="px-4 py-3 flex flex-col gap-y-2">
            {group.values.map((value) => {
              const on = isSelected(selection, group.id, value.value)
              return (
                <li key={value.value}>
                  <LocalizedClientLink
                    href={href(toggled(selection, group.id, value.value))}
                    className={
                      "flex items-center justify-between gap-x-2 text-base-regular hover:text-ui-fg-base " +
                      (on ? "text-ui-fg-base font-semibold" : "text-ui-fg-subtle")
                    }
                  >
                    <span className="flex items-center gap-x-3">
                      <span
                        aria-hidden
                        className={
                          "inline-block w-4 h-4 border rounded-sm " +
                          (on
                            ? "bg-ui-fg-base border-ui-fg-base"
                            : "border-ui-border-base")
                        }
                      />
                      {value.value}
                    </span>
                  </LocalizedClientLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )

  return (
    <>
      {/* On a phone the live site puts a full-width green Filter BUTTON where the bar would
          be. Mine was a <details> summary with the browser's default disclosure triangle —
          which reads as a text link, not a control, and is a smaller tap target than the
          thing it replaces. Same native <details> underneath (no JavaScript, works while the
          page is still loading), styled as the button it is. */}
      <details className="min-[768px]:hidden mb-6 group/filter">
        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer block w-full text-center bg-[#1f3d2b] text-white py-3 text-base-regular">
          Filter
          {selection.length > 0 ? ` (${selection.length})` : ""}
        </summary>
        {/* Bigger tap targets INSIDE the phone panel only.
            yd-store measured every facet row at 24px at a verified 390 — exactly WCAG 2.2 AA's
            24x24 minimum, so not a violation, and well under the 44px both Apple and Google
            call comfortable. Filters are the one control a phone shopper taps repeatedly and
            in sequence, and they are why they opened the panel at all.
            Scoped to the disclosure so the desktop rail keeps the live site's proportions
            exactly: the trade is 44 where the control is load-bearing, parity where it is not.
            Growing the panel costs a little scrolling inside a panel that already scrolls. */}
        <div className="pt-4 [&_li_a]:py-2.5">{body}</div>
      </details>
      <div className="hidden min-[768px]:block">{body}</div>
    </>
  )
}
