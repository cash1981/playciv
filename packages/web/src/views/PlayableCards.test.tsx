// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SQUARE_SIZE,
  createBoard,
  findBoardAsset,
  mapTop,
} from '@civ/engine'
import type { BoardPiece, PlayableCard } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import type { Run } from './GameView.js'
import { MapPickerContext } from './mapPick.js'
import type { MapPicker } from './mapPick.js'
import { PlayCardControl, PlayableCardList, timingLabel } from './PlayableCards.js'

beforeEach(() => {
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.hand')
  vi.restoreAllMocks()
})

const card = (overrides: Partial<PlayableCard> = {}): PlayableCard => ({
  itemId: 'c1',
  name: 'Counterfeiters',
  kind: 'culture',
  description: 'Start of Turn: Choose another player. That player must discard one coin token of your choice.',
  timings: ['SOT'],
  targets: { kind: 'players', min: 1, max: 1 },
  prompt: 'Which player discards a coin token?',
  resources: [],
  automatic: null,
  passive: false,
  discards: true,
  coinSources: [],
  substituteResources: [],
  status: 'ready',
  reason: 'Can be played in start of turn, which you are in.',
  ...overrides,
})

const BOB = { playerId: 'bob', username: 'Bob' }
const CAROL = { playerId: 'carol', username: 'Carol' }
const DAN = { playerId: 'dan', username: 'Dan' }

function viewWith(cards: readonly PlayableCard[], opponents = [BOB, CAROL]): PlayerView {
  return {
    rev: 8,
    you: { playerId: 'me', username: 'Alice', playableCards: cards },
    opponents,
  } as unknown as PlayerView
}

const run: Run = async (action) => {
  await action()
}

const renderControl = (
  view: PlayerView,
  playable: PlayableCard,
  props: { busy?: boolean; readOnly?: boolean } = {},
) =>
  render(
    <PlayCardControl
      card={playable}
      gameId="g1"
      view={view}
      busy={props.busy ?? false}
      readOnly={props.readOnly ?? false}
      run={run}
    />,
  )

const playButton = (name = 'Counterfeiters', verb = 'Play'): HTMLButtonElement =>
  screen.getByRole('button', { name: `${verb} ${name}` }) as HTMLButtonElement
const confirmButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /^Confirm/ }) as HTMLButtonElement

describe('the Play button', () => {
  it('is enabled for a card that is ready, and opens a form that names what the game does', () => {
    renderControl(viewWith([card()]), card())
    expect(playButton().disabled).toBe(false)
    expect(screen.queryByRole('form')).toBeNull()
    fireEvent.click(playButton())
    const form = screen.getByRole('form', { name: 'Play Counterfeiters' })
    expect(within(form).getByText(/The game logs this and discards the card\. It does not apply the effect/)).toBeTruthy()
    expect(playButton().getAttribute('aria-expanded')).toBe('true')
  })

  it('is disabled with the reason in its title and behind help when it cannot be played now', () => {
    const waiting = card({ status: 'wrong-phase', reason: 'Played in start of turn. You are in trade.' })
    renderControl(viewWith([waiting]), waiting)
    expect(playButton().disabled).toBe(true)
    expect(playButton().getAttribute('title')).toBe('Played in start of turn. You are in trade.')
    expect(screen.queryByText('Played in start of turn. You are in trade.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Counterfeiters' }))
    expect(within(screen.getByRole('dialog')).getByText('Played in start of turn. You are in trade.')).toBeTruthy()
    fireEvent.click(playButton())
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('is disabled while the page is busy or read only, and for a spectator renders nothing', () => {
    renderControl(viewWith([card()]), card(), { busy: true })
    expect(playButton().disabled).toBe(true)
    cleanup()
    renderControl(viewWith([card()]), card(), { readOnly: true })
    expect(playButton().disabled).toBe(true)
    cleanup()
    const { container } = renderControl({ rev: 1, you: null, opponents: [] } as unknown as PlayerView, card())
    expect(container.textContent).toBe('')
  })

  it('says Use for a Great Person that stays faceup', () => {
    const stays = card({ name: 'William Shakespeare', kind: 'greatPerson', discards: false, targets: { kind: 'none' }, prompt: '' })
    renderControl(viewWith([stays]), stays)
    // The accessible name starts with the visible text, so "click Use" finds it
    expect(playButton('William Shakespeare', 'Use').textContent).toBe('Use')
    fireEvent.click(playButton('William Shakespeare', 'Use'))
    expect(screen.getByRole('button', { name: 'Confirm use' })).toBeTruthy()
    expect(screen.getByText(/turns the card faceup/)).toBeTruthy()
  })
})

describe('passive Great Persons', () => {
  it('says the passive effect is active while the card stays faceup', () => {
    const valmiki = card({
      name: 'Valmiki',
      kind: 'greatPerson',
      timings: ['ANY'],
      targets: { kind: 'none' },
      prompt: '',
      discards: false,
      passive: true,
      automatic: 'your culture hand size is increased by 2 while Valmiki is faceup',
    })
    renderControl(viewWith([valmiki]), valmiki)
    fireEvent.click(playButton('Valmiki', 'Use'))
    expect(screen.getByText(/The passive effect is active while it stays faceup/)).toBeTruthy()
  })
})

describe('choosing who the card names', () => {
  it('asks the card’s own question and cannot be confirmed before a player is chosen', () => {
    renderControl(viewWith([card()]), card())
    fireEvent.click(playButton())
    expect(screen.getByText('Which player discards a coin token?')).toBeTruthy()
    expect(screen.getByText('Choose 1.')).toBeTruthy()
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
    expect(confirmButton().disabled).toBe(false)
  })

  it('stops at the most players a card names', () => {
    const depression = card({
      name: 'Depression',
      targets: { kind: 'players', min: 1, max: 2 },
      prompt: 'Which players discard a coin token?',
    })
    renderControl(viewWith([depression], [BOB, CAROL, DAN]), depression)
    fireEvent.click(playButton('Depression'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Carol' }))
    expect((screen.getByRole('checkbox', { name: 'Dan' }) as HTMLInputElement).disabled).toBe(true)
    // Taking one off frees the third
    fireEvent.click(screen.getByRole('checkbox', { name: 'Carol' }))
    expect((screen.getByRole('checkbox', { name: 'Dan' }) as HTMLInputElement).disabled).toBe(false)
  })

  it('lets an optional target be left empty', () => {
    const sabotage = card({
      name: 'Sabotage',
      targets: { kind: 'players', min: 0, max: 1 },
      prompt: 'Whose building is destroyed? (optional)',
    })
    renderControl(viewWith([sabotage]), sabotage)
    fireEvent.click(playButton('Sabotage'))
    expect(screen.getByText('Choose up to 1, or nobody.')).toBeTruthy()
    expect(confirmButton().disabled).toBe(false)
  })

  it('chooses the only other player by itself when the card must name one', () => {
    renderControl(viewWith([card()], [BOB]), card())
    fireEvent.click(playButton())
    expect((screen.getByRole('checkbox', { name: 'Bob' }) as HTMLInputElement).checked).toBe(true)
    expect(confirmButton().disabled).toBe(false)
  })

  it('says a card that hits everybody names every other player, and asks nobody', () => {
    const scandal = card({ name: 'Bank Scandal', targets: { kind: 'allOthers' }, prompt: '' })
    renderControl(viewWith([scandal]), scandal)
    fireEvent.click(playButton('Bank Scandal'))
    expect(screen.getByText('This card names every other player.')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(confirmButton().disabled).toBe(false)
  })

  it('needs a resource for a gift, from the list the card allows', () => {
    const gift = card({
      name: 'A Gift from Afar',
      timings: ['ANY'],
      targets: { kind: 'players', min: 1, max: 1 },
      resources: ['Iron', 'Wheat', 'Spy', 'Silk'],
    })
    renderControl(viewWith([gift]), gift)
    fireEvent.click(playButton('A Gift from Afar'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
    expect(confirmButton().disabled).toBe(true)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a resource',
      'Iron',
      'Wheat',
      'Spy',
      'Silk',
    ])
    fireEvent.change(select, { target: { value: 'Iron' } })
    expect(confirmButton().disabled).toBe(false)
  })

  it('asks which coin token Mother Teresa gives, and sends its source', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const teresa = card({
      name: 'Mother Teresa',
      timings: ['SOT'],
      targets: { kind: 'players', min: 1, max: 1 },
      prompt: 'Who receives the coin token?',
      coinSources: [
        { key: 'sheet', label: 'Sheet', coins: 2 },
        { key: 'pottery', label: 'Pottery (I)', coins: 1 },
      ],
    })
    renderControl(viewWith([teresa]), teresa)
    fireEvent.click(playButton('Mother Teresa'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
    expect(confirmButton().disabled).toBe(true)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a coin token',
      'Sheet (2)',
      'Pottery (I) (1)',
    ])
    fireEvent.change(select, { target: { value: 'pottery' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[4]).toEqual({ itemId: 'c1', targets: ['bob'], coinSource: 'pottery' })
  })

  it('asks which resource Marie Curie substitutes for Uranium, and sends it', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const curie = card({
      name: 'Marie Curie',
      timings: ['ANY'],
      targets: { kind: 'none' },
      prompt: '',
      substituteResources: ['Iron', 'Wheat'],
    })
    renderControl(viewWith([curie]), curie)
    fireEvent.click(playButton('Marie Curie'))
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Wheat' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[4]).toEqual({ itemId: 'c1', targets: [], substitute: 'Wheat' })
  })

  it('closes the form on Cancel without sending anything', () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderControl(viewWith([card()]), card())
    fireEvent.click(playButton())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('confirming', () => {
  it('sends one request with the card, the players, the revision and a request id, then closes', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderControl(viewWith([card()]), card())
    fireEvent.click(playButton())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Carol' }))
    fireEvent.click(confirmButton())

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'playCard', expect.any(String), 8, { itemId: 'c1', targets: ['carol'] })
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
  })

  it('sends the resource only for a card that is played as one, and no targets for a card that names none', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const generous = card({
      name: 'A Generous Gift',
      timings: ['ANY'],
      targets: { kind: 'none' },
      prompt: '',
      resources: ['Iron', 'Wheat'],
    })
    renderControl(viewWith([generous]), generous)
    fireEvent.click(playButton('A Generous Gift'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Wheat' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'playCard', expect.any(String), 8, {
      itemId: 'c1',
      targets: [],
      resource: 'Wheat',
    })
  })

  it('sends no targets for a card that names every other player', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const scandal = card({ name: 'Bank Scandal', targets: { kind: 'allOthers' }, prompt: '' })
    renderControl(viewWith([scandal]), scandal)
    fireEvent.click(playButton('Bank Scandal'))
    fireEvent.click(confirmButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[4]).toEqual({ itemId: 'c1', targets: [] })
  })

  it('sends one request for a double click', async () => {
    let release: (view: PlayerView) => void = () => undefined
    const send = vi.spyOn(api, 'actionWithArgs').mockImplementation(
      () => new Promise<PlayerView>((resolve) => (release = resolve)),
    )
    renderControl(viewWith([card()]), card())
    fireEvent.click(playButton())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
    fireEvent.click(confirmButton())
    fireEvent.click(confirmButton())
    expect(send).toHaveBeenCalledTimes(1)
    release({} as PlayerView)
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
  })

  it('sends the same request id again when the answer was lost, and a new one once the press settled', async () => {
    const send = vi
      .spyOn(api, 'actionWithArgs')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({} as PlayerView)
    const quiet: Run = async (action) => {
      try {
        await action()
      } catch {
        /* GameView shows it */
      }
    }
    render(<PlayCardControl card={card()} gameId="g1" view={viewWith([card()])} busy={false} run={quiet} />)
    fireEvent.click(playButton())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
    fireEvent.click(confirmButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    // The form is still open, so the same button can be pressed again
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirmButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[1]?.[2]).toBe(send.mock.calls[0]?.[2])
  })

  it('keeps the form open when the server refuses, so the player can change the choice', async () => {
    vi.spyOn(api, 'actionWithArgs').mockRejectedValue(new Error('refused'))
    const quiet: Run = async (action) => {
      try {
        await action()
      } catch {
        /* GameView shows it */
      }
    }
    render(
      <PlayCardControl card={card()} gameId="g1" view={viewWith([card()])} busy={false} run={quiet} />,
    )
    fireEvent.click(playButton())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
    fireEvent.click(confirmButton())
    await waitFor(() => expect(api.actionWithArgs).toHaveBeenCalled())
    expect(screen.getByRole('form', { name: 'Play Counterfeiters' })).toBeTruthy()
  })
})

describe('Galileo Galilei', () => {
  const galileo = card({
    itemId: 'gp-galileo',
    name: 'Galileo Galilei',
    kind: 'greatPerson',
    description:
      'City Management: You may discard this card to choose a square on the outer edge of the map. Move your figures in that square to any empty square on the outer edge of the map. They cannot move again this turn.',
    timings: ['CM'],
    targets: { kind: 'none' },
    prompt: '',
    automatic:
      'moves every figure in the chosen outer-edge square to another outer-edge square and locks them for the turn',
    discards: true,
    status: 'ready',
    reason: 'Can be played in city management, which you are in.',
  })

  const board = createBoard()
  const army = findBoardAsset('figures/redarmy')
  if (army === undefined) throw new Error('missing army asset')
  const figure: BoardPiece = {
    id: 'army-galileo',
    assetId: army.id,
    path: army.path,
    label: army.label,
    category: 'figure',
    x: Math.round((SQUARE_SIZE - army.width) / 2),
    y: Math.round(mapTop(board) + (SQUARE_SIZE - army.height) / 2),
    width: army.width,
    height: army.height,
    rotation: 0,
    placedBy: 'me',
  }
  const view = {
    rev: 8,
    board: { ...board, pieces: [figure] },
    you: {
      playerId: 'me',
      username: 'Alice',
      color: 'Red',
      civilization: null,
      stats: { mvmt: '2' },
      items: [],
      socialPolicies: [],
      techsChosen: [],
      playerTurns: [],
      playableCards: [galileo],
    },
    opponents: [],
  } as unknown as PlayerView

  it('goes straight from the source pick to the edge pick and asks to confirm', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const begin = vi
      .fn()
      .mockResolvedValueOnce({ column: 0, row: 0, label: 'A1' })
      .mockResolvedValueOnce({ column: 0, row: 2, label: 'A3' })
    const mapPicker: MapPicker = { begin, cancel: vi.fn() }

    render(
      <MapPickerContext.Provider value={mapPicker}>
        <PlayCardControl card={galileo} gameId="g1" view={view} busy={false} run={run} />
      </MapPickerContext.Provider>,
    )

    fireEvent.click(playButton('Galileo Galilei'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose source square' }))
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(2))
    expect(begin.mock.calls[1]?.[0]).toMatchObject({
      title: 'the Galileo destination square',
    })
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/A1 to A3/))

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[4]).toMatchObject({
      itemId: 'gp-galileo',
      from: { column: 0, row: 0 },
      to: { column: 0, row: 2 },
    })
  })

  it('leaves the card unplayed when the Galileo confirmation is cancelled', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const begin = vi
      .fn()
      .mockResolvedValueOnce({ column: 0, row: 0, label: 'A1' })
      .mockResolvedValueOnce({ column: 0, row: 2, label: 'A3' })
    const mapPicker: MapPicker = { begin, cancel: vi.fn() }

    render(
      <MapPickerContext.Provider value={mapPicker}>
        <PlayCardControl card={galileo} gameId="g1" view={view} busy={false} run={run} />
      </MapPickerContext.Provider>,
    )
    fireEvent.click(playButton('Galileo Galilei'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose source square' }))

    await waitFor(() => expect(begin).toHaveBeenCalledTimes(2))
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Choose destination square' })).toBeTruthy()
  })

  it('keeps the source button pressable when no figure is on the edge, with a reason', () => {
    const begin = vi.fn()
    const mapPicker: MapPicker = { begin, cancel: vi.fn() }
    const emptyView = {
      ...view,
      board: { ...board, pieces: [] },
    } as unknown as PlayerView
    render(
      <MapPickerContext.Provider value={mapPicker}>
        <PlayCardControl card={galileo} gameId="g1" view={emptyView} busy={false} run={run} />
      </MapPickerContext.Provider>,
    )

    fireEvent.click(playButton('Galileo Galilei'))
    const source = screen.getByRole('button', { name: 'Choose source square' }) as HTMLButtonElement
    expect(source.disabled).toBe(false)
    fireEvent.click(source)
    expect(screen.getByText(/None of your figures is on the map/)).toBeTruthy()
    expect(begin).not.toHaveBeenCalled()
  })

  it('cancels an open board pick when the card form closes', async () => {
    const begin = vi.fn().mockResolvedValue(null)
    const cancel = vi.fn()
    const mapPicker: MapPicker = { begin, cancel }
    render(
      <MapPickerContext.Provider value={mapPicker}>
        <PlayCardControl card={galileo} gameId="g1" view={view} busy={false} run={run} />
      </MapPickerContext.Provider>,
    )

    fireEvent.click(playButton('Galileo Galilei'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose source square' }))
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('form', { name: 'Play Galileo Galilei' })).toBeNull()
  })
})

describe('the list of cards in a phase tab', () => {
  const sot = card()
  const anyTime = card({
    itemId: 'c2',
    name: 'Bread and Circuses',
    description: 'Any Time: Cancel a culture event targeting you.',
    timings: ['ANY'],
    reason: 'Can be played at any time.',
  })
  const cm = card({
    itemId: 'c3',
    name: 'We Love the Despot Day!',
    description: 'City Management: Choose one of your cities. It produces 4 extra hammers this turn.',
    timings: ['CM'],
    targets: { kind: 'none' },
    reason: 'Played in city management. You are in start of turn.',
  })
  const list = (phase: 'SOT' | 'TRADE' | 'CM', view = viewWith([cm, sot, anyTime])) =>
    render(<PlayableCardList gameId="g1" view={view} phase={phase} busy={false} readOnly={false} run={run} />)

  it('shows the cards played in the phase and the any-time cards, ready ones first', () => {
    list('SOT')
    const names = within(screen.getByRole('list')).getAllByRole('listitem').map(
      (item) => item.querySelector('.playable-card-name')?.textContent,
    )
    expect(names).toEqual(['Counterfeiters', 'Bread and Circuses'])
    expect(screen.queryByText('We Love the Despot Day!')).toBeNull()
  })

  it('shows where a card is played but not its long text', () => {
    list('SOT')
    expect(screen.queryByText(/^Start of Turn: Choose another player/)).toBeNull()
    expect(screen.getByText('Start of turn')).toBeTruthy()
    expect(screen.getByText('Any time')).toBeTruthy()
  })

  it('lists an any-time card in every tab, and a card of that phase only in its own', () => {
    list('TRADE')
    expect(screen.getByText('Bread and Circuses')).toBeTruthy()
    expect(screen.queryByText('Counterfeiters')).toBeNull()
    cleanup()
    list('CM')
    expect(screen.getByText('We Love the Despot Day!')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Play We Love the Despot Day!' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('leaves out a card that cannot be played now', () => {
    const blocked = card({
      itemId: 'c4',
      name: 'Blocked card',
      timings: ['SOT'],
      status: 'unavailable',
      reason: 'Already used.',
    })
    const { container } = list('SOT', viewWith([sot, blocked]))
    expect(container.textContent).not.toContain('Blocked card')
    expect(container.textContent).toContain('Counterfeiters')
  })

  it('renders nothing when no card of the hand can be played in the phase', () => {
    const { container } = list('TRADE', viewWith([sot]))
    expect(container.textContent).toBe('')
  })

  it('tolerates a view without playableCards, and renders nothing for a spectator', () => {
    const old = { rev: 1, you: { playerId: 'me', username: 'Alice' }, opponents: [] } as unknown as PlayerView
    const { container } = list('SOT', old)
    expect(container.textContent).toBe('')
    cleanup()
    const spectator = list('SOT', { rev: 1, you: null, opponents: [] } as unknown as PlayerView)
    expect(spectator.container.textContent).toBe('')
  })

  it('links a card name to the same card in the hand', () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    localStorage.setItem('civ.panel.hand', 'false')
    render(
      <>
        <PlayableCardList gameId="g1" view={viewWith([sot])} phase="SOT" busy={false} readOnly={false} run={run} />
        <CollapsiblePanel id="hand" title="Your hand (1)" defaultOpen>
          <p>cards</p>
          <ul>
            <li id="hand-item-c1" tabIndex={-1}>
              Counterfeiters
            </li>
          </ul>
        </CollapsiblePanel>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show Counterfeiters in your hand' }))
    // The collapsed hand opens; the card gets the focus and the scroll after the render.
    return waitFor(() => {
      expect(localStorage.getItem('civ.panel.hand')).toBe('true')
      expect(scrolled.map((element) => element.id)).toContain('hand-item-c1')
      expect(document.activeElement?.id).toBe('hand-item-c1')
    }).finally(() => {
      Element.prototype.scrollIntoView = original
      localStorage.removeItem('civ.panel.hand')
    })
  })
})

describe('timingLabel', () => {
  it('reads the timings of a card', () => {
    expect(timingLabel(['SOT'])).toBe('Start of turn')
    expect(timingLabel(['SOT', 'CM'])).toBe('Start of turn or city management')
    expect(timingLabel(['ANY'])).toBe('Any time')
  })
})
