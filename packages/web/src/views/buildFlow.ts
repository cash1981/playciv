/**
 * The state a Build shares between the Cities panel (where it starts), the board
 * (where the square is picked) and the confirm bar, all rendered by GameView.
 *
 * The flow holds only what the player chose. What is legal comes from the
 * engine's `buildOptions` on every refresh, so after each one the flow is
 * checked against the fresh options and drops what no longer fits, saying why.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { sameBuildItem } from '@civ/engine'

import type { BuildChoice, BuildItem, BuildSquare, CityBuildOptions } from '../lib/api.js'

export const OPTIONS_CHANGED = 'The options changed, pick again.'
export const SQUARE_GONE = 'That square is no longer available, pick another.'

/**
 * A short, stable text for an item: `building:<asset id>`, `army`, `scout` or
 * `unit:<type>`. For React keys and request keys; the engine's `assetId` of a
 * choice is only a list key, and an item is what the server takes.
 */
export function itemKeyOf(item: BuildItem): string {
  if (item.kind === 'building') return `building:${item.assetId}`
  if (item.kind === 'unit') return `unit:${item.unitType}`
  return item.kind
}

/**
 * A choice the player has started: the item, the city, and the square once one is
 * picked. A unit (`placement` is `none`) is a private card with no square, so its
 * `squares` are empty and its `target` stays `null`.
 */
export interface BuildPlan {
  readonly cityPieceId: string
  readonly cityLabel: string
  readonly item: BuildItem
  readonly placement: BuildChoice['placement']
  readonly label: string
  readonly cost: number
  readonly tradeToPay: number
  readonly squares: readonly BuildSquare[]
  readonly target: BuildSquare | null
}

export interface BuildFlow {
  /** The city whose picker is open in the Cities panel. */
  readonly pickerCityId: string | null
  readonly plan: BuildPlan | null
  /** Why the flow went back a step, for example "The options changed, pick again." */
  readonly note: string | null
  /** What the server said when it refused the build. */
  readonly message: string | null
  openPicker(cityPieceId: string): void
  closePicker(): void
  start(city: CityBuildOptions, choice: BuildChoice): void
  pick(square: BuildSquare): void
  /** Cancel, Escape and a successful build all end here: nothing is left open. */
  clear(): void
  refused(message: string): void
}

interface State {
  readonly pickerCityId: string | null
  readonly plan: BuildPlan | null
  readonly note: string | null
  readonly message: string | null
}

const EMPTY: State = { pickerCityId: null, plan: null, note: null, message: null }

const sameSquare = (a: BuildSquare, b: BuildSquare): boolean => a.column === b.column && a.row === b.row

const sameSquareWithNote = (a: BuildSquare, b: BuildSquare): boolean =>
  sameSquare(a, b) && a.note === b.note

const samePlan = (a: BuildPlan, b: BuildPlan): boolean =>
  a.cityLabel === b.cityLabel &&
  sameBuildItem(a.item, b.item) &&
  a.placement === b.placement &&
  a.label === b.label &&
  a.cost === b.cost &&
  a.tradeToPay === b.tradeToPay &&
  a.squares.length === b.squares.length &&
  a.squares.every((square, index) => {
    const other = b.squares[index]
    return other !== undefined && sameSquareWithNote(square, other)
  }) &&
  (a.target === null ? b.target === null : b.target !== null && sameSquareWithNote(a.target, b.target))

/**
 * Checks the flow against fresh options. Returns the same object when nothing
 * that matters changed, so a refresh does not disturb the player.
 */
function reconcile(state: State, options: readonly CityBuildOptions[]): State {
  const cityStillThere =
    state.pickerCityId === null || options.some((city) => city.cityPieceId === state.pickerCityId)
  let next = cityStillThere ? state : { ...state, pickerCityId: null, note: OPTIONS_CHANGED }

  const plan = state.plan
  if (plan === null) return next

  const city = options.find((candidate) => candidate.cityPieceId === plan.cityPieceId)
  const choice =
    city?.status === 'ready'
      ? city.choices.find((candidate) => sameBuildItem(candidate.item, plan.item))
      : undefined
  if (city === undefined || choice === undefined) {
    // Back to the picker of the same city, if it is still there, with fresh choices.
    return {
      ...next,
      pickerCityId: city === undefined ? null : plan.cityPieceId,
      plan: null,
      note: OPTIONS_CHANGED,
    }
  }

  // The picked square is kept as the fresh options list it (with its current note),
  // or forgotten when it is no longer legal. A unit has no square to keep.
  const planned = plan.target
  const target =
    planned === null ? null : (choice.squares.find((square) => sameSquare(square, planned)) ?? null)
  const fresh: BuildPlan = {
    cityPieceId: plan.cityPieceId,
    cityLabel: city.label,
    item: choice.item,
    placement: choice.placement,
    label: choice.label,
    cost: choice.cost,
    tradeToPay: choice.tradeToPay,
    squares: choice.squares,
    target,
  }
  if (samePlan(plan, fresh)) return next
  next = { ...next, plan: fresh, note: plan.target !== null && target === null ? SQUARE_GONE : next.note }
  return next
}

/**
 * `options` is the viewer's `buildOptions`, or `null` when building is not
 * possible at all (a spectator, a replay, an ended game): everything is cleared.
 */
export function useBuildFlow(options: readonly CityBuildOptions[] | null): BuildFlow {
  const [state, setState] = useState<State>(EMPTY)

  useEffect(() => {
    setState((current) => {
      if (options === null) return current === EMPTY ? current : EMPTY
      return reconcile(current, options)
    })
  }, [options])

  const openPicker = useCallback((cityPieceId: string) => {
    setState({ pickerCityId: cityPieceId, plan: null, note: null, message: null })
  }, [])
  const closePicker = useCallback(() => setState(EMPTY), [])
  const start = useCallback((city: CityBuildOptions, choice: BuildChoice) => {
    setState({
      pickerCityId: null,
      plan: {
        cityPieceId: city.cityPieceId,
        cityLabel: city.label,
        item: choice.item,
        placement: choice.placement,
        label: choice.label,
        cost: choice.cost,
        tradeToPay: choice.tradeToPay,
        squares: choice.squares,
        target: null,
      },
      note: null,
      message: null,
    })
  }, [])
  const pick = useCallback((square: BuildSquare) => {
    setState((current) =>
      current.plan === null
        ? current
        : { ...current, plan: { ...current.plan, target: square }, note: null, message: null },
    )
  }, [])
  const refused = useCallback((message: string) => setState((current) => ({ ...current, message })), [])

  return useMemo(
    () => ({ ...state, openPicker, closePicker, start, pick, clear: closePicker, refused }),
    [state, openPicker, closePicker, start, pick, refused],
  )
}
