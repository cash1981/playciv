/**
 * The state a Build shares between Your actions (where it starts), the board
 * (where the square is picked) and the confirm bar, all rendered by GameView.
 *
 * The flow holds only what the player chose. What is legal comes from the
 * engine's `buildOptions` on every refresh, so after each one the flow is
 * checked against the fresh options and drops what no longer fits, saying why.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { TRADE_PER_RUSH_STEP, sameBuildItem } from '@civ/engine'

import type { BuildChoice, BuildItem, BuildSquare, CityBuildOptions } from '../lib/api.js'

export const OPTIONS_CHANGED = 'The options changed, pick again.'
export const SQUARE_GONE = 'That square is no longer available, pick another.'

/**
 * A short, stable text for an item: `building:<asset id>`, `wonder:<asset id>`,
 * `army`, `scout` or `unit:<type>`. For React keys and request keys; the engine's
 * `assetId` of a choice is only a list key, and an item is what the server takes.
 */
export function itemKeyOf(item: BuildItem): string {
  if (item.kind === 'building' || item.kind === 'wonder') return `${item.kind}:${item.assetId}`
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
  /** A wonder with a discount: the other price, for the bar to read. */
  readonly costNote?: string | undefined
  readonly tradeToPay: number
  readonly squares: readonly BuildSquare[]
  readonly target: BuildSquare | null
  /** The production the city builds with, for the rush of two items together. */
  readonly production: number
  /** Engineering is revealed and unused: the production a step of 3 trade covers (2 for the Americans, else 1). Absent otherwise. */
  readonly perStep?: number | undefined
}

/** Engineering's second item: the choice of the same city, and its square once one is picked. */
export interface SecondPlan {
  readonly item: BuildItem
  readonly placement: BuildChoice['placement']
  readonly label: string
  readonly cost: number
  readonly squares: readonly BuildSquare[]
  readonly target: BuildSquare | null
}

/** The trade the two items cost together against the city's production, counted once (Engineering, ruling 80). */
export function combinedTrade(plan: BuildPlan, second: SecondPlan | null): number {
  if (second === null) return plan.tradeToPay
  const shortfall = Math.max(0, plan.cost + second.cost - plan.production)
  return Math.ceil(shortfall / (plan.perStep ?? 1)) * TRADE_PER_RUSH_STEP
}

export interface BuildFlow {
  /** The city whose picker is open in Your actions. */
  readonly pickerCityId: string | null
  readonly plan: BuildPlan | null
  /** Engineering's second item, chosen in the bar; `null` for an ordinary build. */
  readonly second: SecondPlan | null
  /** Why the flow went back a step, for example "The options changed, pick again." */
  readonly note: string | null
  /** What the server said when it refused the build. */
  readonly message: string | null
  /** The player said yes to "this city has already acted this turn, act again?" when the picker was opened. */
  readonly confirmedAgain: boolean
  openPicker(cityPieceId: string, confirmedAgain?: boolean): void
  closePicker(): void
  start(city: CityBuildOptions, choice: BuildChoice): void
  pick(square: BuildSquare): void
  /** Chooses the second item (Engineering) from the city's choices, or `null` to build one item. */
  chooseSecond(choice: BuildChoice | null): void
  pickSecond(square: BuildSquare | null): void
  /** Cancel, Escape and a successful build all end here: nothing is left open. */
  clear(): void
  refused(message: string): void
}

interface State {
  readonly pickerCityId: string | null
  readonly plan: BuildPlan | null
  readonly second: SecondPlan | null
  readonly note: string | null
  readonly message: string | null
  readonly confirmedAgain: boolean
}

const EMPTY: State = { pickerCityId: null, plan: null, second: null, note: null, message: null, confirmedAgain: false }

const sameSquare = (a: BuildSquare, b: BuildSquare): boolean => a.column === b.column && a.row === b.row

const sameSquareWithNote = (a: BuildSquare, b: BuildSquare): boolean =>
  sameSquare(a, b) && a.note === b.note

const samePlan = (a: BuildPlan, b: BuildPlan): boolean =>
  a.cityLabel === b.cityLabel &&
  sameBuildItem(a.item, b.item) &&
  a.placement === b.placement &&
  a.label === b.label &&
  a.cost === b.cost &&
  a.costNote === b.costNote &&
  a.tradeToPay === b.tradeToPay &&
  a.production === b.production &&
  a.perStep === b.perStep &&
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
      second: null,
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
    costNote: choice.costNote,
    tradeToPay: choice.tradeToPay,
    squares: choice.squares,
    target,
    production: city.production,
    perStep: city.engineering?.perStep,
  }
  // The second item is kept as the fresh options list it, or dropped with the options when Engineering is gone or the item no longer fits
  const wanted = state.second
  const secondChoice =
    wanted === null || city.engineering === undefined
      ? undefined
      : city.choices.find((candidate) => sameBuildItem(candidate.item, wanted.item))
  const secondTarget =
    wanted?.target === null || wanted === null || secondChoice === undefined
      ? null
      : (secondChoice.squares.find((square) => sameSquare(square, wanted.target as BuildSquare)) ?? null)
  const freshSecond: SecondPlan | null =
    wanted === null || secondChoice === undefined
      ? null
      : {
          item: secondChoice.item,
          placement: secondChoice.placement,
          label: secondChoice.label,
          cost: secondChoice.cost,
          squares: secondChoice.squares,
          target: secondTarget,
        }
  const secondSame =
    freshSecond === null || wanted === null
      ? freshSecond === wanted
      : freshSecond.label === wanted.label &&
        freshSecond.cost === wanted.cost &&
        freshSecond.squares.length === wanted.squares.length &&
        freshSecond.squares.every((square, index) => {
          const other = wanted.squares[index]
          return other !== undefined && sameSquareWithNote(square, other)
        }) &&
        (freshSecond.target === null ? wanted.target === null : wanted.target !== null && sameSquareWithNote(freshSecond.target, wanted.target))
  if (samePlan(plan, fresh) && secondSame) return next
  next = {
    ...next,
    plan: fresh,
    second: freshSecond,
    note:
      wanted !== null && freshSecond === null
        ? OPTIONS_CHANGED
        : (plan.target !== null && target === null) || (wanted?.target != null && freshSecond?.target === null)
          ? SQUARE_GONE
          : next.note,
  }
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

  const openPicker = useCallback((cityPieceId: string, confirmedAgain = false) => {
    setState({ pickerCityId: cityPieceId, plan: null, second: null, note: null, message: null, confirmedAgain })
  }, [])
  const closePicker = useCallback(() => setState(EMPTY), [])
  const start = useCallback((city: CityBuildOptions, choice: BuildChoice) => {
    setState((current) => ({
      confirmedAgain: current.confirmedAgain,
      pickerCityId: null,
      plan: {
        cityPieceId: city.cityPieceId,
        cityLabel: city.label,
        item: choice.item,
        placement: choice.placement,
        label: choice.label,
        cost: choice.cost,
        costNote: choice.costNote,
        tradeToPay: choice.tradeToPay,
        squares: choice.squares,
        target: null,
        production: city.production,
        perStep: city.engineering?.perStep,
      },
      second: null,
      note: null,
      message: null,
    }))
  }, [])
  const chooseSecond = useCallback((choice: BuildChoice | null) => {
    setState((current) => ({
      ...current,
      second:
        choice === null
          ? null
          : {
              item: choice.item,
              placement: choice.placement,
              label: choice.label,
              cost: choice.cost,
              squares: choice.squares,
              // A single legal square is taken at once
              target: choice.squares.length === 1 ? (choice.squares[0] ?? null) : null,
            },
      message: null,
    }))
  }, [])
  const pickSecond = useCallback((square: BuildSquare | null) => {
    setState((current) =>
      current.second === null ? current : { ...current, second: { ...current.second, target: square }, message: null },
    )
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
    () => ({ ...state, openPicker, closePicker, start, pick, chooseSecond, pickSecond, clear: closePicker, refused }),
    [state, openPicker, closePicker, start, pick, chooseSecond, pickSecond, refused],
  )
}
