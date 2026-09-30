import { useEffect, useState } from 'react'

/**
 * Keep the digits of what was typed and drop leading zeros. A `type="number"`
 * input shows "01" when a phone user types 1 over a 0 and gives no way to get
 * to a bare 1, so these fields are text inputs with a numeric keypad instead.
 */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

/** No digits, or anything that is not a number, counts as 0. */
export function digitsToNumber(digits: string): number {
  const parsed = Number.parseInt(digits, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * `min` and `max` are applied when the field loses focus, so the box shows the
 * value that will be used; while typing, the value is reported as typed.
 */
export function DigitInput({
  value,
  onValueChange,
  min,
  max,
  ...rest
}: {
  readonly value: number
  readonly onValueChange: (value: number) => void
  readonly min?: number
  readonly max?: number
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onFocus' | 'onBlur' | 'type' | 'inputMode' | 'pattern' | 'min' | 'max'
>): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))

  // Follow a value that changed from outside (a fresh server value), but do
  // not overwrite an empty draft while the player is still typing.
  useEffect(() => {
    setDraft((current) => (digitsToNumber(current) === value ? current : String(value)))
  }, [value])

  function settle(): void {
    const typed = digitsToNumber(draft)
    const clamped = Math.min(max ?? typed, Math.max(min ?? typed, typed))
    setDraft(String(clamped))
    if (clamped !== typed) onValueChange(clamped)
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const digits = digitsOnly(event.target.value)
        setDraft(digits)
        onValueChange(digitsToNumber(digits))
      }}
      onBlur={settle}
    />
  )
}
