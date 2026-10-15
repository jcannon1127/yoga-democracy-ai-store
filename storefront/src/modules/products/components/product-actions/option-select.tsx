import { HttpTypes } from "@medusajs/types"
import React from "react"

import { optionValueLabel, sortOptionValues } from "@lib/util/sizes"
import { ValueState } from "@lib/util/variant-matrix"

type OptionSelectProps = {
  option: HttpTypes.StoreProductOption
  current: string | undefined
  updateOption: (optionId: string, value: string) => void
  title: string
  disabled: boolean
  states: ValueState[]
  "data-testid"?: string
}

/**
 * A labelled dropdown — "Select Size", "Select Length" — matching the live product page.
 *
 * The starter rendered options as a row of buttons. That breaks down here: YD runs up to
 * eight sizes plus two lengths, the buttons wrapped into an unreadable grid, and they had no
 * way to show a size as existing-but-unavailable. The live site uses a native `<select>` per
 * attribute with unavailable values `disabled` but still listed, so that is what this is.
 *
 * Native `<select>` also gets phone behaviour for free — the OS picker — and Jeff reviews on
 * a phone.
 */
const OptionSelect: React.FC<OptionSelectProps> = ({
  option,
  current,
  updateOption,
  title,
  states,
  "data-testid": dataTestId,
  disabled,
}) => {
  const byValue = new Map(states.map((s) => [s.value, s]))
  const values = sortOptionValues(
    title,
    (option.values ?? []).map((v) => v.value)
  )

  const selectId = `option-${option.id}`

  return (
    <div className="flex flex-col gap-y-2">
      <label htmlFor={selectId} className="yd-buybox-label">
        Select {title}
      </label>
      <select
        id={selectId}
        value={current ?? ""}
        disabled={disabled}
        onChange={(e) => updateOption(option.id, e.target.value)}
        data-testid={dataTestId}
        // Everything about how this looks is in `.yd-select` (see globals.css). It was a
        // Tailwind class list until the arrow's data-URI — which contains spaces — was found
        // to be shattering into half a dozen junk class names in the browser.
        className="yd-select"
      >
        <option value="">Select {title}</option>
        {values.map((value) => {
          const state = byValue.get(value)
          return (
            <option
              key={value}
              value={value}
              disabled={state?.disabled}
              data-attr-value={value}
              data-testid="option-value"
            >
              {optionValueLabel(title, value)}
            </option>
          )
        })}
      </select>
    </div>
  )
}

export default OptionSelect
