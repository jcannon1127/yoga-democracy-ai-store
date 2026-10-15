import { Checkbox, Label } from "@medusajs/ui"
import React from "react"

type CheckboxProps = {
  checked?: boolean
  onChange?: () => void
  label: string
  name?: string
  'data-testid'?: string
}

const CheckboxWithLabel: React.FC<CheckboxProps> = ({
  checked = true,
  onChange,
  label,
  name,
  'data-testid': dataTestId
}) => {
  const id = name ?? "checkbox"
  const labelId = `${id}-label`

  return (
    <div className="flex items-center space-x-2 ">
      <Checkbox
        className="text-base-regular flex items-center gap-x-2"
        id={id}
        role="checkbox"
        type="button"
        checked={checked}
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={onChange}
        name={name}
        data-testid={dataTestId}
      />
      <Label
        id={labelId}
        htmlFor={id}
        className="!transform-none !txt-medium"
        size="large"
      >
        {label}
      </Label>
    </div>
  )
}

export default CheckboxWithLabel
