import { HttpTypes } from "@medusajs/types"
import { Text } from "@medusajs/ui"

type LineItemOptionsProps = {
  variant: HttpTypes.StoreProductVariant | undefined
  "data-testid"?: string
  "data-value"?: HttpTypes.StoreProductVariant
}

/**
 * What the customer actually chose — every option, not just the variant title.
 *
 * `variant.title` is a single string. On a product with Size AND Length it is just "XXL",
 * so a customer who deliberately picked `Standard (28")` over `Long (34")` sees no trace of
 * that choice in their cart, their confirmation email's counterpart, or their order history.
 *
 * That became load-bearing the moment length became a real choice on 19 product groups: the
 * inseam is the whole reason those products were merged, and YD processes returns by hand.
 * A wrong-length return that could have been prevented by one line of text is expensive in
 * exactly the way this migration is trying to avoid.
 *
 * Falls back to the variant title when options are not loaded, so a fetch that omits them
 * degrades to the old behaviour rather than rendering nothing.
 */
const LineItemOptions = ({
  variant,
  "data-testid": dataTestid,
  "data-value": dataValue,
}: LineItemOptionsProps) => {
  const options = (variant?.options ?? [])
    .map((o) => ({ title: (o as any)?.option?.title as string | undefined, value: o?.value }))
    .filter((o) => o.title && o.value)

  return (
    <Text
      data-testid={dataTestid}
      data-value={dataValue}
      className="inline-block txt-medium text-ui-fg-subtle w-full overflow-hidden text-ellipsis"
    >
      {options.length
        ? options.map((o) => `${o.title}: ${o.value}`).join(" · ")
        : `Variant: ${variant?.title ?? ""}`}
    </Text>
  )
}

export default LineItemOptions
