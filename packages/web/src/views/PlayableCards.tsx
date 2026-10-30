/**
 * Playing a culture event or Great Person card (assisted play, part 13).
 *
 * Two places use the same {@link PlayCardControl}: the phase tabs, which list the
 * ready cards of the hand that can be played in that phase, and the hand itself, where
 * each card that can ever be played has a Play button. Whether it is enabled is the
 * engine's answer in `view.you.playableCards`; nothing here knows a card's timing. A
 * listed card's name goes to the same card in the hand.
 *
 * Playing asks first, because it takes the card out of the hand: who the card names
 * (the log says it), the resource a gift is played as, then Confirm. The game only
 * logs the play and discards the card. Except for the few cards the engine carries out
 * (`automatic`), it does not apply the effect, because another player may cancel the
 * card, so the control says so.
 */

import { useId, useState } from 'react'

import {
  brandenburgForbiddenCells,
  CARD_TIMING_TEXT,
  GALILEO_NAME,
  cardMoveDestinations,
  cardMoveFigureChoices,
  cardMoveSources,
  cardWaterRulesOf,
  figuresAt,
  figureSources,
  galileoDestinations,
  galileoSources,
  squareLabel,
} from '@civ/engine'
import type { CardTiming, PlayableCard, TurnPhase } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { pressOnce } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { HelpHint } from './HelpHint.js'
import { useMapPicker } from './mapPick.js'
import { goToHandItem } from './PhaseSummary.js'
import './PlayableCards.css'

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** "Start of turn", "Start of turn or city management": where the card is played. */
export const timingLabel = (timings: readonly CardTiming[]): string =>
  capitalized(timings.map((timing) => CARD_TIMING_TEXT[timing]).join(' or '))

/** The most players a card can name that the picker must keep inside its limit. */
const targetLimit = (card: PlayableCard): { readonly min: number; readonly max: number } =>
  card.targets.kind === 'players' ? card.targets : { min: 0, max: 0 }

const moveDestinationEmptyNote = (count: number): React.JSX.Element | null =>
  count === 0 ? <p className="muted">No empty destination square is left.</p> : null

interface ControlProps {
  readonly card: PlayableCard
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly?: boolean
  readonly run: Run
}

/**
 * The Play button of one card, with its form while it is open. Disabled, with the
 * reason as text, when the card cannot be played now.
 */
export function PlayCardControl({
  card,
  gameId,
  view,
  busy,
  readOnly = false,
  run,
}: ControlProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [resource, setResource] = useState('')
  const [coinSource, setCoinSource] = useState('')
  const [substitute, setSubstitute] = useState('')
  const [convertFrom, setConvertFrom] = useState<'trade' | 'culture'>('trade')
  const [convertAmount, setConvertAmount] = useState('')
  const [moveFrom, setMoveFrom] = useState<{ readonly column: number; readonly row: number } | null>(null)
  const [moveTo, setMoveTo] = useState<{ readonly column: number; readonly row: number } | null>(null)
  const [moveHint, setMoveHint] = useState<string | null>(null)
  const [moveFigureId, setMoveFigureId] = useState<string | null>(null)
  const [hannibalSelected, setHannibalSelected] = useState<readonly string[]>([])
  const mapPicker = useMapPicker()
  const formId = useId()
  if (view.you === null) return null
  const viewer = view.you

  const ready = card.status === 'ready'
  const others = view.opponents
  const { min, max } = targetLimit(card)
  const needsResource = card.resources.length > 0
  const needsCoin = card.coinSources.length > 0
  const needsSubstitute = card.substituteResources.length > 0
  const conversion = card.conversion ?? null
  const convertHeld = conversion === null ? 0 : conversion[convertFrom]
  const convertWhole = Number(convertAmount)
  const convertValid = conversion === null || (Number.isInteger(convertWhole) && convertWhole >= 1 && convertWhole <= convertHeld)
  const isGalileo = card.name === GALILEO_NAME
  const cardMove = card.mapMove ?? null
  const isMapMove = isGalileo || cardMove !== null
  const turnNumber = view.activeTurn?.turnNumber ?? 0
  // A card that must name exactly one player, in a game with one other player, has no choice to make
  const effective =
    card.targets.kind === 'players' && min >= 1 && others.length === 1 && chosen.length === 0
      ? others.map((opponent) => opponent.playerId)
      : chosen
  const viewerForbidden = brandenburgForbiddenCells(view.brandenburgZones, viewer.playerId)
  const isLockedSquare = (cell: { readonly column: number; readonly row: number }): boolean =>
    view.communismLocks.some((locked) => locked.column === cell.column && locked.row === cell.row)
  const groupHoldersAt = (from: { readonly column: number; readonly row: number }) =>
    others.filter((opponent) => figuresAt(view.board, opponent, from).length > 0)
  const groupSourceCells = (() => {
    if (cardMove?.kind !== 'group') return []
    const cells = new Map<string, { column: number; row: number }>()
    for (const opponent of others) {
      for (const cell of cardMoveSources(view.board, opponent, turnNumber, 'group')) {
        cells.set(`${cell.column},${cell.row}`, cell)
      }
    }
    return [...cells.values()].filter((cell) => groupHoldersAt(cell).length === 1)
  })()
  const moveSourceCells = (
    isGalileo
      ? galileoSources(view.board, viewer, turnNumber)
      : cardMove?.kind === 'one'
        ? cardMoveSources(view.board, viewer, turnNumber, 'one')
        : cardMove?.kind === 'hannibal'
          ? cardMoveSources(view.board, viewer, turnNumber, 'one')
          : groupSourceCells
  ).filter((cell) => !isLockedSquare(cell))
  const moveFigureChoices =
    cardMove?.kind === 'one' && moveFrom !== null
      ? cardMoveFigureChoices(view.board, viewer, moveFrom, turnNumber)
      : []
  const hannibalSourceFigures =
    cardMove?.kind === 'hannibal' && moveFrom !== null
      ? cardMoveFigureChoices(view.board, viewer, moveFrom, turnNumber)
      : []
  const hannibalDestinationCount =
    cardMove?.kind === 'hannibal' && moveTo !== null
      ? figuresAt(view.board, viewer, moveTo).length
      : 0
  const hannibalRoom = Math.max(0, viewer.stackingLimit - hannibalDestinationCount)
  const hannibalNeedsChoice =
    cardMove?.kind === 'hannibal' &&
    moveTo !== null &&
    hannibalSourceFigures.length > 1
  const destinationCellsFor = (from: { readonly column: number; readonly row: number }) =>
    isGalileo
      ? galileoDestinations(view.board, from, viewerForbidden)
      : cardMove?.kind === 'hannibal'
        ? figureSources(view.board, viewer)
            .filter((cell) => cell.column !== from.column || cell.row !== from.row)
            .filter((cell) => figuresAt(view.board, viewer, cell).length < viewer.stackingLimit)
            .filter((cell) => !viewerForbidden.some((blocked) => blocked.column === cell.column && blocked.row === cell.row))
            .map((cell) => ({ ...cell, label: squareLabel(cell), distance: 0 }))
        : cardMove === null
          ? []
          : cardMoveDestinations(
            view.board,
            from,
            cardMove.allowance,
            cardMove.kind === 'one'
              ? cardWaterRulesOf(viewer)
              : { cross: false, end: false },
            cardMove.kind === 'one'
              ? viewer.techsChosen.some((tech) => tech.name === 'Flight' && !tech.hidden)
              : groupHoldersAt(from)[0]?.revealedTechs.some((tech) => tech.name === 'Flight') === true,
            view.communismLocks,
            cardMove.kind === 'one'
              ? viewerForbidden
              : brandenburgForbiddenCells(view.brandenburgZones, groupHoldersAt(from)[0]?.playerId ?? ''),
            cardMove.kind === 'one'
              ? { owner: viewer, stackingLimit: viewer.stackingLimit }
              : { owner: groupHoldersAt(from)[0] ?? viewer, stackingLimit: groupHoldersAt(from)[0]?.stats.stacking ?? 1 },
          )
  const moveDestinationCells = moveFrom === null ? [] : destinationCellsFor(moveFrom)
  const baseValid =
    effective.length >= min &&
    effective.length <= max &&
    (!needsResource || resource !== '') &&
    (!needsCoin || coinSource !== '') &&
    (!needsSubstitute || substitute !== '') &&
    convertValid
  const valid = baseValid
  const disabled = busy || readOnly

  const resetMove = (): void => {
    setMoveFrom(null)
    setMoveTo(null)
    setMoveFigureId(null)
    setHannibalSelected([])
    setMoveHint(null)
  }

  const toggle = (playerId: string): void => {
    resetMove()
    setChosen(
      effective.includes(playerId)
        ? effective.filter((id) => id !== playerId)
        : effective.length >= max
          ? effective
          : [...effective, playerId],
    )
  }

  const sendPlay = (
    from: { readonly column: number; readonly row: number } | null = moveFrom,
    to: { readonly column: number; readonly row: number } | null = moveTo,
    figureId: string | null = moveFigureId,
    figureIds: readonly string[] = hannibalSelected,
  ): void => {
    if (!baseValid) return
    if (isMapMove && (from === null || to === null)) return
    if (cardMove?.kind === 'one' && figureId === null) return
    const playerId = viewer.playerId
    const key = `${gameId}:${playerId}:playCard:${card.itemId}:${[...effective].sort().join(',')}:${resource}:${coinSource}:${substitute}:${conversion === null ? '' : `${convertFrom}${convertAmount}`}:${from?.column ?? ''},${from?.row ?? ''}:${to?.column ?? ''},${to?.row ?? ''}:${figureId ?? ''}:${[...figureIds].sort().join(',')}`
    void pressOnce(
      key,
      run,
      (requestId) =>
        api.actionWithArgs(gameId, 'playCard', requestId, view.rev, {
          itemId: card.itemId,
          targets: card.targets.kind === 'players' ? effective : [],
          ...(needsResource ? { resource } : {}),
          ...(needsCoin ? { coinSource } : {}),
          ...(needsSubstitute ? { substitute } : {}),
          ...(conversion === null ? {} : { convert: { from: convertFrom, amount: convertWhole } }),
          ...(isMapMove && from !== null && to !== null ? { from, to } : {}),
          ...(cardMove?.kind === 'one' && figureId !== null ? { figureId } : {}),
          ...(cardMove?.kind === 'hannibal' ? { figureIds } : {}),
        }),
      view,
    ).then((succeeded) => {
      if (succeeded) {
        resetMove()
        setOpen(false)
      }
    })
  }

  const confirm = (): void => {
    if (!valid) return
    sendPlay()
  }

  const pickMapMoveDestination = async (
    from: { readonly column: number; readonly row: number },
    figureId: string | null = moveFigureId,
  ): Promise<void> => {
    if (mapPicker === null) return
    const cells = destinationCellsFor(from)
    if (cells.length === 0) {
      setMoveHint(
        cardMove?.kind === 'hannibal'
          ? 'No other square with your figures has room for another figure.'
          : 'No empty square is reachable with this card.',
      )
      return
    }
    const picked = await mapPicker.begin({
      title: isGalileo ? 'the Galileo destination square' : `the ${card.name} destination square`,
      cells,
      describeCell: isGalileo
        ? (cell) => `Move ${GALILEO_NAME}'s figures to ${cell.label}`
        : (cell) =>
            cardMove?.kind === 'group'
              ? `Move the other player's figures to ${cell.label}`
              : cardMove?.kind === 'hannibal'
                ? `Move ${card.name}'s figures to ${cell.label}`
                : `Move ${card.name}'s figure to ${cell.label}`,
    })
    if (picked === null) return
    const to = { column: picked.column, row: picked.row }
    setMoveTo(to)
    setMoveHint(null)
    if (cardMove?.kind === 'hannibal') {
      const sourceFigures = cardMoveFigureChoices(view.board, viewer, from, turnNumber)
      const room = Math.max(0, viewer.stackingLimit - figuresAt(view.board, viewer, to).length)
      const selected = sourceFigures.slice(0, room)
      if (selected.length === 0) {
        setMoveHint(`${squareLabel(to)} has no room for another of your figures.`)
        return
      }
      setHannibalSelected(selected.map((piece) => piece.id))
      if (sourceFigures.length > 1) return
      if (
        window.confirm(
          `Move ${selected.length} ${selected.length === 1 ? 'figure' : 'figures'} from ` +
            `${squareLabel(from)} to ${squareLabel(to)} with ${card.name}?`,
        )
      ) {
        sendPlay(from, to, null, selected.map((piece) => piece.id))
      }
      return
    }
    const figure = figureId === null ? undefined : view.board.pieces.find((piece) => piece.id === figureId)
    const message = isGalileo
      ? `Move every figure in ${squareLabel(from)} to ${squareLabel(to)} with ${GALILEO_NAME}?`
      : cardMove?.kind === 'group'
        ? (() => {
            const holder = groupHoldersAt(from)[0]
            return (
              `Move ${holder === undefined ? 0 : figuresAt(view.board, holder, from).length} figures of ` +
              `${holder?.username ?? 'the other player'} from ${squareLabel(from)} to ${squareLabel(to)} with ${card.name}?`
            )
          })()
        : `Move ${figure?.label ?? 'the figure'} from ${squareLabel(from)} to ${squareLabel(to)} with ${card.name}?`
    if (window.confirm(message)) sendPlay(from, to, figureId)
  }

  const pickMapMoveSource = async (): Promise<void> => {
    if (mapPicker === null) return
    const cells = moveSourceCells.map((cell) => ({ ...cell, label: squareLabel(cell) }))
    if (cells.length === 0) {
      setMoveHint(
        cardMove?.kind === 'group'
          ? 'No square with another player\'s figures is available.'
          : 'None of your figures is on the map.',
      )
      return
    }
    setMoveHint(null)
    const picked = await mapPicker.begin({
      title: isGalileo ? 'the Galileo source square' : `the ${card.name} source square`,
      cells,
      describeCell: isGalileo
        ? (cell) => `Choose ${cell.label} as the source square for ${GALILEO_NAME}`
        : (cell) =>
            cardMove?.kind === 'group'
              ? `Choose ${cell.label} for the other player's figures`
              : `Choose ${cell.label} as the source square for ${card.name}`,
    })
    if (picked === null) return
    const from = { column: picked.column, row: picked.row }
    if (cardMove?.kind === 'group' && groupHoldersAt(from).length !== 1) {
      setMoveHint('Choose a square holding figures of exactly one other player.')
      return
    }
    setMoveFrom(from)
    setMoveTo(null)
    setMoveHint(null)
    if (cardMove?.kind === 'one') {
      const choices = cardMoveFigureChoices(view.board, viewer, from, turnNumber)
      if (choices.length === 0) {
        setMoveHint('No figure there may be moved by this card.')
        return
      }
      const first = choices[0]?.id ?? null
      setMoveFigureId(first)
      if (choices.length === 1) await pickMapMoveDestination(from, first)
      return
    }
    setMoveFigureId(null)
    await pickMapMoveDestination(from)
  }

  const repickMapMoveDestination = (): void => {
    if (moveFrom !== null) void pickMapMoveDestination(moveFrom, moveFigureId)
  }

  const changeMoveFigure = (figureId: string): void => {
    setMoveFigureId(figureId)
    if (moveFrom !== null) void pickMapMoveDestination(moveFrom, figureId)
  }

  const toggleHannibalFigure = (figureId: string): void => {
    setHannibalSelected((current) =>
      current.includes(figureId)
        ? current.filter((id) => id !== figureId)
        : current.length >= hannibalRoom
          ? current
          : [...current, figureId],
    )
  }

  const confirmHannibal = (): void => {
    if (moveFrom === null || moveTo === null || hannibalSelected.length === 0) return
    if (
      window.confirm(
        `Move ${hannibalSelected.length} ${hannibalSelected.length === 1 ? 'figure' : 'figures'} from ` +
          `${squareLabel(moveFrom)} to ${squareLabel(moveTo)} with ${card.name}?`,
      )
    ) {
      sendPlay(moveFrom, moveTo, null, hannibalSelected)
    }
  }

  const closeForm = (): void => {
    mapPicker?.cancel()
    resetMove()
    setOpen(false)
  }

  return (
    <div className="play-card">
      <div className="play-card-row">
        <button
          type="button"
          className="small"
          aria-label={`${card.kind === 'greatPerson' && !card.discards ? 'Use' : 'Play'} ${card.name}`}
          aria-expanded={ready ? open : undefined}
          aria-controls={ready && open ? formId : undefined}
          disabled={disabled || !ready}
          title={ready ? undefined : card.reason}
          onClick={() => {
            if (open) closeForm()
            else setOpen(true)
          }}
        >
          {card.kind === 'greatPerson' && !card.discards ? 'Use' : 'Play'}
        </button>
        {!ready && <HelpHint label={card.name}>{card.reason}</HelpHint>}
      </div>

      {ready && open && (
        <form
          id={formId}
          className="play-card-form"
          aria-label={`Play ${card.name}`}
          onSubmit={(event) => {
            event.preventDefault()
            if (!isMapMove) confirm()
          }}
        >
          {card.targets.kind === 'players' && (
            <fieldset className="play-card-targets">
              <legend>{card.prompt}</legend>
              {others.length === 0 && <p className="muted">There is no other player.</p>}
              {others.map((opponent) => (
                <label key={opponent.playerId} className="play-card-target">
                  <input
                    type="checkbox"
                    checked={effective.includes(opponent.playerId)}
                    disabled={disabled || (!effective.includes(opponent.playerId) && effective.length >= max)}
                    onChange={() => toggle(opponent.playerId)}
                  />{' '}
                  {opponent.username}
                </label>
              ))}
              <p className="muted">
                {min === max
                  ? `Choose ${min}.`
                  : min === 0
                    ? `Choose up to ${max}, or nobody.`
                    : `Choose ${min} to ${max}.`}
              </p>
            </fieldset>
          )}
          {card.targets.kind === 'allOthers' && (
            <p className="play-card-all">This card names every other player.</p>
          )}
          {isMapMove && (
            <fieldset className="play-card-targets">
              <legend>
                {isGalileo
                  ? 'Move figures to the outer edge'
                  : cardMove?.kind === 'group'
                    ? `${card.name}: move another player's figures`
                    : cardMove?.kind === 'hannibal'
                      ? `${card.name}: move figures to another group`
                      : `${card.name}: move one figure`}
              </legend>
              <p className="muted">
                {isGalileo
                  ? 'Every one of your figures in the source square moves together to an empty outer-edge square.'
                  : cardMove?.kind === 'group'
                    ? "Choose a square with exactly one other player's figures, then an empty destination with no water on the way."
                    : cardMove?.kind === 'hannibal'
                      ? `Choose a square with your figures, then another square with your figures. You may move any or all that fit the stacking limit (${viewer.stackingLimit}).`
                      : `Choose one of your figures, then an empty square up to ${cardMove?.allowance ?? 0} squares away.`}
              </p>
              <div className="play-card-buttons">
                <button
                  type="button"
                  className="small"
                  disabled={disabled || mapPicker === null}
                  onClick={() => void pickMapMoveSource()}
                >
                  Choose source square
                </button>
                <span>{moveFrom === null ? 'No source chosen' : squareLabel(moveFrom)}</span>
              </div>
              {moveHint !== null && moveSourceCells.length === 0 && (
                <p className="muted">{moveHint}</p>
              )}
              {moveHint === null && moveSourceCells.length === 0 && (
                <p className="muted">
                  {cardMove?.kind === 'group'
                    ? "No square with another player's figures is available."
                    : 'None of your figures is on the map.'}
                </p>
              )}
              {cardMove?.kind === 'one' && moveFrom !== null && moveFigureChoices.length > 1 && (
                <label className="play-card-resource">
                  Figure{' '}
                  <select
                    value={moveFigureId ?? ''}
                    disabled={disabled}
                    onChange={(event) => changeMoveFigure(event.target.value)}
                  >
                    {moveFigureChoices.map((figure, index) => (
                      <option key={figure.id} value={figure.id}>
                        {figure.label} {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="play-card-buttons">
                <button
                  type="button"
                  className="small"
                  disabled={disabled || mapPicker === null || moveFrom === null || moveDestinationCells.length === 0}
                  onClick={repickMapMoveDestination}
                >
                  Choose destination square
                </button>
                <span>{moveTo === null ? 'No destination chosen' : squareLabel(moveTo)}</span>
              </div>
              {cardMove?.kind !== 'hannibal' && moveDestinationEmptyNote(moveDestinationCells.length)}
              {cardMove?.kind === 'hannibal' && moveTo !== null && hannibalNeedsChoice && (
                <fieldset className="play-card-targets">
                  <legend>Figures to move (up to {hannibalRoom})</legend>
                  {hannibalSourceFigures.map((figure, index) => (
                    <label key={figure.id} className="play-card-target">
                      <input
                        type="checkbox"
                        checked={hannibalSelected.includes(figure.id)}
                        disabled={
                          disabled ||
                          (!hannibalSelected.includes(figure.id) && hannibalSelected.length >= hannibalRoom)
                        }
                        onChange={() => toggleHannibalFigure(figure.id)}
                      />{' '}
                      {figure.label} {index + 1}
                    </label>
                  ))}
                  <div className="play-card-buttons">
                    <button
                      type="button"
                      className="small"
                      disabled={disabled || hannibalSelected.length === 0}
                      onClick={confirmHannibal}
                    >
                      Move selected figures
                    </button>
                  </div>
                </fieldset>
              )}
              <div className="play-card-buttons">
                <button type="button" className="small" onClick={closeForm}>
                  Cancel
                </button>
              </div>
            </fieldset>
          )}
          {needsResource && (
            <label className="play-card-resource">
              Play it as{' '}
              <select
                value={resource}
                disabled={disabled}
                onChange={(event) => setResource(event.target.value)}
              >
                <option value="">Choose a resource</option>
                {card.resources.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needsCoin && (
            <label className="play-card-resource">
              Give from{' '}
              <select
                value={coinSource}
                disabled={disabled}
                onChange={(event) => setCoinSource(event.target.value)}
              >
                <option value="">Choose a coin token</option>
                {card.coinSources.map((source) => (
                  <option key={source.key} value={source.key}>
                    {source.label} ({source.coins})
                  </option>
                ))}
              </select>
            </label>
          )}
          {needsSubstitute && (
            <label className="play-card-resource">
              Spend instead of Uranium{' '}
              <select
                value={substitute}
                disabled={disabled}
                onChange={(event) => setSubstitute(event.target.value)}
              >
                <option value="">Choose a resource</option>
                {card.substituteResources.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {conversion !== null && (
            <label className="play-card-resource">
              Turn{' '}
              <select
                value={convertFrom}
                disabled={disabled}
                onChange={(event) => setConvertFrom(event.target.value === 'culture' ? 'culture' : 'trade')}
              >
                <option value="trade">trade into culture ({conversion.trade})</option>
                <option value="culture">culture into trade ({conversion.culture})</option>
              </select>{' '}
              <input
                type="number"
                min={1}
                max={convertHeld}
                value={convertAmount}
                disabled={disabled}
                aria-label="Amount to turn"
                onChange={(event) => setConvertAmount(event.target.value)}
              />
            </label>
          )}
          <p className="muted play-card-note">
            The game logs this and {card.discards ? 'discards the card' : 'turns the card faceup'}.{' '}
            {card.passive
              ? `The passive effect is active while it stays faceup: ${card.automatic}.`
              : card.automatic === null
                ? 'It does not apply the effect: do that yourself unless another player cancels the card.'
                : `It also ${card.automatic}. Undo it with a vote if another player cancels the card.`}
          </p>
          {!isMapMove && (
            <div className="play-card-buttons">
              <button type="submit" className="small" disabled={disabled || !valid}>
                {card.kind === 'greatPerson' && !card.discards ? 'Confirm use' : 'Confirm play'}
              </button>
              <button type="button" className="small" onClick={closeForm}>
                Cancel
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  )
}

interface ListProps {
  readonly gameId: string
  readonly view: PlayerView
  readonly phase: TurnPhase
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/**
 * The ready cards of the hand that belong to a phase tab: the ones played in that phase
 * and the ones that can be played at any time, which are listed in every tab. Nothing
 * when no such card is ready, and nothing for a spectator.
 */
export function PlayableCardList({
  gameId,
  view,
  phase,
  busy,
  readOnly,
  run,
}: ListProps): React.JSX.Element | null {
  if (view.you === null) return null
  const cards = (view.you.playableCards ?? []).filter(
    (card) =>
      card.status === 'ready' && (card.timings.includes(phase) || card.timings.includes('ANY')),
  )
  if (cards.length === 0) return null

  return (
    <section className="phase-group" aria-label="Cards you can play">
      <h3 className="phase-group-title">Cards you can play</h3>
      <ul className="playable-cards">
        {cards.map((card) => (
          <li key={card.itemId} className="playable-card">
            <button
              type="button"
              className="link playable-card-name"
              title={`Show ${card.name} in your hand`}
              aria-label={`Show ${card.name} in your hand`}
              onClick={() => goToHandItem(card.itemId)}
            >
              {card.name}
            </button>{' '}
            <span className="tag">{timingLabel(card.timings)}</span>
            <PlayCardControl
              card={card}
              gameId={gameId}
              view={view}
              busy={busy}
              readOnly={readOnly}
              run={run}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
