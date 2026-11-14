import type { AvailableAction, ResourcePaymentChoice, ResourcePaymentOption } from '@civ/engine'

export type ResourcePayment = NonNullable<AvailableAction['payment']>

export const paymentKey = (choice: ResourcePaymentChoice): string =>
  JSON.stringify([choice.kind, choice.id, choice.resource])

const sourceKey = (choice: ResourcePaymentChoice): string => JSON.stringify([choice.kind, choice.id])

function optionsFor(payment: ResourcePayment, index: number): readonly ResourcePaymentOption[] {
  const cost = payment.cost[index]
  const seen = new Set<string>()
  return payment.options.filter((option) => {
    if (cost !== null) return option.choice.resource === cost
    // Any-resource costs need only one entry per physical payment, not one per
    // resource a Gift can represent. Do not spend Curie's one-shot substitute.
    if (option.usesCurie) return false
    const key = sourceKey(option.choice)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Find a complete payment, preserving choices when possible, never reusing a token or card. */
export function resourcePaymentSelection(
  payment: ResourcePayment,
  preferred: readonly ResourcePaymentChoice[] = [],
  fixed?: { readonly index: number; readonly key: string },
): readonly ResourcePaymentOption[] {
  const find = (
    index: number,
    selected: readonly ResourcePaymentOption[],
    used: ReadonlySet<string>,
    curieUsed: boolean,
  ): readonly ResourcePaymentOption[] | undefined => {
    if (index === payment.cost.length) return selected
    const wanted = preferred[index]
    const options = optionsFor(payment, index)
      .filter((option) => fixed?.index !== index || paymentKey(option.choice) === fixed.key)
      .sort((a, b) => {
        const rank = (option: ResourcePaymentOption): number =>
          wanted !== undefined && paymentKey(option.choice) === paymentKey(wanted) ? -1 : option.choice.kind === 'card' ? 1 : 0
        return rank(a) - rank(b)
      })
    for (const option of options) {
      const source = sourceKey(option.choice)
      if (used.has(source) || (curieUsed && option.usesCurie)) continue
      const next = find(index + 1, [...selected, option], new Set([...used, source]), curieUsed || option.usesCurie === true)
      if (next !== undefined) return next
    }
    return undefined
  }
  return find(0, [], new Set(), false) ?? []
}

/** An already-confirmed payment must still exist verbatim; never silently replace it. */
export function paymentStillAvailable(payment: ResourcePayment, choices: readonly ResourcePaymentChoice[]): boolean {
  if (choices.length !== payment.cost.length) return false
  const selected = resourcePaymentSelection(payment, choices)
  return selected.length === choices.length && selected.every((option, index) => {
    const choice = choices[index]
    return choice !== undefined && paymentKey(option.choice) === paymentKey(choice)
  })
}

interface Props {
  readonly payment: ResourcePayment
  readonly selected: readonly ResourcePaymentOption[]
  readonly onChange: (choices: readonly ResourcePaymentChoice[]) => void
}

export function ResourcePaymentPicker({ payment, selected, onChange }: Props): React.JSX.Element {
  const choices = selected.map((option) => option.choice)
  return (
    <span className="assisted-any-pick" role="group" aria-label="Resource payments">
      {payment.cost.map((_, index) => {
        const current = selected[index]
        const options = optionsFor(payment, index).filter((option) =>
          resourcePaymentSelection(payment, choices, { index, key: paymentKey(option.choice) }).length === payment.cost.length,
        )
        return (
          <select
            key={index}
            aria-label={`Resource ${index + 1}`}
            value={current === undefined ? '' : paymentKey(current.choice)}
            onChange={(event) => onChange(
              resourcePaymentSelection(payment, choices, { index, key: event.target.value }).map((option) => option.choice),
            )}
          >
            {current === undefined && <option value="">No available payment</option>}
            {options.map((option) => (
              <option key={paymentKey(option.choice)} value={paymentKey(option.choice)}>
                {option.label}
              </option>
            ))}
          </select>
        )
      })}
      <span className="muted">Choose tokens from your hand or player area, or a culture card to play and discard.</span>
      {selected.length !== payment.cost.length && (
        <span role="status" className="assisted-warning">A selected payment is no longer available, or you have too few usable resources. Choose the payments again.</span>
      )}
    </span>
  )
}
