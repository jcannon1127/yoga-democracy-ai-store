const MAX_QUANTITY = 10

/**
 * Quantity, 1-10, beside the size dropdown — as on the live product page.
 *
 * The starter has no quantity control on the PDP at all; you add one, go to the cart, and
 * change it there. That is a small friction on a repeat-purchase catalogue (people buy two
 * of a legging they already own), and its absence is immediately visible side by side with
 * the live page.
 *
 * 10 is the live site's ceiling, not a considered stock limit.
 */
const QuantitySelect = ({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (quantity: number) => void
  disabled?: boolean
}) => (
  <div className="flex flex-col gap-y-2">
    <label htmlFor="product-quantity" className="yd-buybox-label">
      Quantity
    </label>
    <select
      id="product-quantity"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      data-testid="product-quantity-select"
      // See `.yd-select` in globals.css, and the bug note there.
      className="yd-select"
    >
      {Array.from({ length: MAX_QUANTITY }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  </div>
)

export default QuantitySelect
