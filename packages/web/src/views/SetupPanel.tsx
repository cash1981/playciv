/**
 * The Setup tab of "Your actions" (#374): what a player does once, before turn 1, in the order they like.
 *
 * A checklist with one row per step the engine lists in `view.you.setup`: the capital (or the Indian metropolis), the
 * figures (army, scout and the Russian or Spanish white figure, one item each), the social policy, the American great
 * person, the starting trade, the government (shown only, the civilization forces it) and Egypt's wonder. Every row says
 * where it stands and why it is blocked; the buttons are the ones the step allows now.
 *
 * Nothing here is a rule. The squares a step may use, whether it can be undone and why not come from the engine's
 * projection, and the server checks every press again. A square is picked on the map (`useMapPicker`, as Build does):
 * the square that comes back is checked against the current view before anything is sent, and a refused or declined send
 * reopens nothing, the row's button starts again. The social policy is chosen in the Social policy panel, which this row
 * links to, and the card to keep for the great person in the choice above the tabs.
 */

import { useEffect, useRef, useState } from 'react'

import { squareLabel } from '@civ/engine'
import type { GrowDirection } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView, SetupRequestBody } from '../lib/api.js'
import { pressOnce } from './AssistedActions.js'
import type { PickableSquare } from './BoardView.js'
import type { Run } from './GameView.js'
import { useMapPicker } from './mapPick.js'
import type { MapPickRequest } from './mapPick.js'
import { goToPanel } from './PhaseSummary.js'
import './SetupPanel.css'

type Setup = NonNullable<NonNullable<PlayerView['you']>['setup']>
type Step = Setup['steps'][number]
type Item = Step['items'][number]
type Square = Step['squares'][number]

interface Cell {
  readonly column: number
  readonly row: number
}

/** What a pick is for: a square of the capital, of one figure or of Egypt's wonder. */
type Target = { readonly kind: 'capital' } | { readonly kind: 'wonder' } | { readonly kind: 'figure'; readonly figure: Item['id'] }

const STATUS_TEXT: Readonly<Record<Step['status'], string>> = {
  done: 'Done',
  todo: 'To do',
  blocked: 'Blocked',
  auto: 'Automatic',
}

/** Where the second square of the Indian metropolis lies, from its anchor square. The same names the server takes. */
const DIRECTION_STEP: Readonly<Record<GrowDirection, Cell>> = {
  north: { column: 0, row: -1 },
  west: { column: -1, row: 0 },
  east: { column: 1, row: 0 },
  south: { column: 0, row: 1 },
}

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

const toCell = (cell: Cell): PickableSquare => ({ column: cell.column, row: cell.row, label: squareLabel(cell) })

/** One legal metropolis: the square the server is told (with its direction) and the two squares it covers. */
interface Pair {
  readonly square: Square
  readonly first: Cell
  readonly second: Cell
}

function pairsOf(squares: readonly Square[]): readonly Pair[] {
  return squares.flatMap((square) => {
    if (square.direction === undefined) return []
    const step = DIRECTION_STEP[square.direction]
    return [{ square, first: { column: square.column, row: square.row }, second: { column: square.column + step.column, row: square.row + step.row } }]
  })
}

/** The squares of a target in the current view, in the engine's order. */
function squaresOf(view: PlayerView, target: Target): readonly Square[] {
  const steps = view.you?.setup?.steps ?? []
  if (target.kind === 'figure') return steps.find((step) => step.id === 'figures')?.items.find((item) => item.id === target.figure)?.squares ?? []
  return steps.find((step) => step.id === target.kind)?.squares ?? []
}

/** The trade the engine will add when it counts: the trade icons around the capital, held to the trade track. */
function tradeToAdd(you: NonNullable<PlayerView['you']>): number | null {
  const estimate = you.tradeEstimate
  const trade = you.stats?.trade
  if (estimate === undefined || trade === undefined) return null
  return Math.max(0, Math.min(estimate.ceiling, trade + estimate.cities) - trade)
}

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/** The setup checklist. Nothing for a spectator, a replayed revision or a player with no setup (the tab is not shown then). */
export function SetupPanel({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const setup = view.you?.setup ?? null
  const mapPicker = useMapPicker()
  const [sending, setSending] = useState(false)
  // The row whose map pick is open, and a note when the square that was picked could not be used
  const [picking, setPicking] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const open = useRef<{ key: string; settled: boolean } | null>(null)
  // A pick resolves later than the render that opened it: it is checked and sent with the latest view
  const latest = useRef({ view, busy: busy || readOnly })
  useEffect(() => {
    latest.current = { view, busy: busy || readOnly }
  })
  // Leaving the tab (or the game) closes a pick that is still open; a settled one is left alone
  useEffect(
    () => () => {
      if (open.current !== null && !open.current.settled) mapPicker?.cancel()
    },
    [mapPicker],
  )
  if (view.you === null || setup === null) return null
  const you = view.you
  const playerId = you.playerId
  const disabled = busy || readOnly || sending

  const pickOn = async (key: string, request: MapPickRequest): Promise<PickableSquare | null> => {
    if (mapPicker === null) return null
    const mine = { key, settled: false }
    open.current = mine
    setPicking(key)
    const cell = await mapPicker.begin(request)
    mine.settled = true
    if (open.current === mine) {
      open.current = null
      setPicking(null)
    }
    return cell
  }

  const send = (key: string, body: SetupRequestBody): void => {
    setSending(true)
    const seen = latest.current.view
    void pressOnce(
      `${gameId}:${playerId}:setup:${key}:${JSON.stringify(body)}`,
      run,
      (requestId) => api.setup(gameId, body, requestId, seen.rev),
      seen,
    ).then(() => setSending(false))
  }

  /** The square the player picked, if it is still one the current view offers; otherwise a note and nothing is sent. */
  const stillOffered = (target: Target, cell: Cell): Square | null => {
    if (latest.current.busy) {
      setNotice('The game was busy and the square was not sent. Pick again.')
      return null
    }
    const square = squaresOf(latest.current.view, target).find((candidate) => sameCell(candidate, cell))
    if (square === undefined) setNotice('That square is no longer available. Pick again.')
    return square ?? null
  }

  const pickSquare = async (target: Target, key: string, title: string, describe: (cell: PickableSquare) => string): Promise<Square | null> => {
    const squares = squaresOf(view, target)
    if (squares.length === 0) return null
    setNotice(null)
    const cell = await pickOn(key, { title, cells: squares.map(toCell), describeCell: describe })
    return cell === null ? null : stillOffered(target, cell)
  }

  /**
   * The Indian metropolis covers two squares, and a square alone does not say which: the first square is picked, then
   * (when it can go two ways) the second. The pair that is sent is the one the view lists, as its anchor and direction.
   */
  const pickMetropolis = async (verb: 'Place' | 'Move'): Promise<Square | null> => {
    const target: Target = { kind: 'capital' }
    const pairs = pairsOf(squaresOf(view, target))
    if (pairs.length === 0) return null
    setNotice(null)
    const partners = (pool: readonly Pair[], cell: Cell): readonly Pair[] => pool.filter((pair) => sameCell(pair.first, cell) || sameCell(pair.second, cell))
    const firsts: Cell[] = []
    for (const pair of pairs) for (const cell of [pair.first, pair.second]) if (!firsts.some((known) => sameCell(known, cell))) firsts.push(cell)
    const first = await pickOn('capital', {
      title: 'the first square of your metropolis',
      cells: firsts.map(toCell),
      describeCell: (cell) => {
        const options = partners(pairs, cell)
        return options.length === 1 && options[0] !== undefined
          ? `${verb} your metropolis ${verb === 'Move' ? 'to' : 'on'} ${options[0].square.covers ?? ''}`
          : `Start your metropolis on ${cell.label}: you then choose the square it also covers`
      },
    })
    if (first === null) return null
    const options = partners(pairs, first)
    let chosen = options[0]
    if (options.length > 1) {
      const otherOf = (pair: Pair): Cell => (sameCell(pair.first, first) ? pair.second : pair.first)
      const second = await pickOn('capital', {
        title: `the square your metropolis also covers next to ${squareLabel(first)}`,
        cells: options.map((pair) => toCell(otherOf(pair))),
        describeCell: (cell) => {
          const pair = options.find((candidate) => sameCell(otherOf(candidate), cell))
          return `${verb} your metropolis ${verb === 'Move' ? 'to' : 'on'} ${pair?.square.covers ?? `${squareLabel(first)} and ${cell.label}`}`
        },
      })
      if (second === null) return null
      chosen = options.find((pair) => sameCell(otherOf(pair), second))
    }
    if (chosen === undefined) return null
    if (latest.current.busy) {
      setNotice('The game was busy and the square was not sent. Pick again.')
      return null
    }
    // Judged again on the latest view: the same anchor and direction must still be listed
    const wanted = chosen.square
    const current = squaresOf(latest.current.view, target).find((square) => sameCell(square, wanted) && square.direction === wanted.direction)
    if (current === undefined) setNotice('That square is no longer available. Pick again.')
    return current ?? null
  }

  const placeCapital = async (moving: boolean): Promise<void> => {
    const verb = moving ? 'Move' : 'Place'
    const indian = squaresOf(view, { kind: 'capital' }).some((square) => square.direction !== undefined)
    const square = indian
      ? await pickMetropolis(verb)
      : await pickSquare({ kind: 'capital' }, 'capital', 'your capital', (cell) => `${verb} your capital ${verb === 'Move' ? 'to' : 'on'} ${cell.label}`)
    if (square === null) return
    send('capital', {
      step: 'capital',
      column: square.column,
      row: square.row,
      ...(square.direction === undefined ? {} : { direction: square.direction }),
    })
  }

  const placeFigure = async (item: Item): Promise<void> => {
    const target: Target = { kind: 'figure', figure: item.id }
    const square = await pickSquare(target, `figure:${item.id}`, `your ${item.label}`, (cell) => `Place your ${item.label} on ${cell.label}`)
    if (square !== null) send(`figure:${item.id}`, { step: 'figure', figure: item.id, column: square.column, row: square.row })
  }

  const placeWonder = async (): Promise<void> => {
    const square = await pickSquare({ kind: 'wonder' }, 'wonder', "Egypt's wonder", (cell) => `Place Egypt's wonder on ${cell.label}`)
    if (square !== null) send('wonder', { step: 'wonder', column: square.column, row: square.row })
  }

  const drawGreatPerson = (): void => {
    setNotice(null)
    setSending(true)
    const seen = latest.current.view
    void pressOnce(
      `${gameId}:${playerId}:setupGreatPerson`,
      run,
      (requestId) => api.performAction(gameId, 'setupGreatPerson', requestId, seen.rev),
      seen,
    ).then(() => setSending(false))
  }

  const undo = (body: SetupRequestBody): void => {
    setNotice(null)
    send('undo', body)
  }

  const noPicker = mapPicker === null
  /** The button that starts a map pick, or ends the one that is open. */
  const pickButton = (key: string, text: string, label: string, start: () => void, blocked: boolean): React.JSX.Element =>
    picking === key ? (
      <button type="button" className="small" onClick={() => mapPicker?.cancel()}>
        Cancel pick
      </button>
    ) : (
      <button type="button" className="small" aria-label={label} disabled={disabled || noPicker || blocked} onClick={start}>
        {text}
      </button>
    )

  const undoButton = (label: string, body: SetupRequestBody): React.JSX.Element => (
    <button type="button" className="small" aria-label={`Undo ${label}`} title={`Undo ${label}`} disabled={disabled} onClick={() => undo(body)}>
      Undo
    </button>
  )

  const rewardWaiting = (you.pendingRewards ?? []).some((reward) => reward.kind === 'greatPerson')

  const rowActions = (step: Step): React.JSX.Element | null => {
    const blocked = step.status === 'blocked'
    switch (step.id) {
      case 'capital': {
        const placed = step.status === 'done'
        return (
          <>
            {placed
              ? step.squares.length > 0 && pickButton('capital', 'Move', 'Move capital', () => void placeCapital(true), false)
              : pickButton('capital', 'Place capital', 'Place capital', () => void placeCapital(false), blocked)}
            {step.canUndo && undoButton('capital', { undo: true, step: 'capital' })}
          </>
        )
      }
      case 'policy':
        return (
          <button type="button" className="small" onClick={() => goToPanel('social-policy', true)}>
            {step.status === 'done' ? 'Show social policy' : 'Choose in Social policy'}
          </button>
        )
      case 'greatPerson':
        return (
          <>
            {step.status !== 'done' && !rewardWaiting && (
              <button type="button" className="small" disabled={disabled || blocked} onClick={drawGreatPerson}>
                Draw great person
              </button>
            )}
            {blocked && /social policy/i.test(step.reason) && (
              <button type="button" className="small" onClick={() => goToPanel('social-policy', true)}>
                Go to Social policy
              </button>
            )}
          </>
        )
      case 'trade': {
        const amount = tradeToAdd(you)
        return (
          <>
            {step.status !== 'done' && (
              <button type="button" className="small" disabled={disabled || blocked} onClick={() => send('trade', { step: 'trade' })}>
                {amount === null ? 'Count trade' : `Count trade (+${amount})`}
              </button>
            )}
            {step.canUndo && undoButton('starting trade', { undo: true, step: 'trade' })}
          </>
        )
      }
      case 'wonder':
        return (
          <>
            {step.status !== 'done' && pickButton('wonder', 'Place wonder', "Place Egypt's wonder", () => void placeWonder(), blocked)}
            {step.canUndo && undoButton("Egypt's wonder", { undo: true, step: 'wonder' })}
          </>
        )
      case 'figures':
      case 'government':
        return null
    }
  }

  const itemActions = (item: Item): React.JSX.Element => (
    <>
      {item.status !== 'done' && pickButton(`figure:${item.id}`, 'Place', `Place ${item.label}`, () => void placeFigure(item), item.status === 'blocked')}
      {item.canUndo && undoButton(item.label, { undo: true, step: 'figure', figure: item.id })}
    </>
  )

  return (
    <section className="setup-panel" aria-label="Setup">
      {setup.blocksTurn === null ? (
        <p className="setup-summary muted">Setup is complete. It closes when you end Start of Turn; until then you can still move or take back a step.</p>
      ) : (
        <p role="status" className="assisted-warning setup-summary">
          {setup.blocksTurn}
        </p>
      )}
      {notice !== null && (
        <p role="status" className="assisted-warning setup-notice">
          {notice}
        </p>
      )}
      <ol className="setup-steps">
        {setup.steps.map((step) => (
          <li key={step.id} className={`setup-step setup-${step.status}`} data-step={step.id}>
            <div className="setup-step-head">
              <h4 className="setup-step-name">{step.label}</h4>
              <span className="tag">{STATUS_TEXT[step.status]}</span>
            </div>
            <p className="setup-reason muted">{step.reason}</p>
            {step.items.length > 0 && (
              <ul className="setup-items">
                {step.items.map((item) => (
                  <li key={item.id} className={`setup-item setup-${item.status}`} data-figure={item.id}>
                    <div className="setup-step-head">
                      <span className="setup-item-name">{item.label}</span>
                      <span className="tag">{STATUS_TEXT[item.status]}</span>
                    </div>
                    <p className="setup-reason muted">{item.reason}</p>
                    <div className="assisted-action">{itemActions(item)}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="assisted-action">{rowActions(step)}</div>
            {step.status === 'done' && step.undoReason !== null && !step.canUndo && (
              <p className="setup-undo-reason muted">Undo unavailable: {step.undoReason}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
