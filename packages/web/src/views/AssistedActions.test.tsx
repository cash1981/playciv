// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { ApiError, api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { AssistedActionButton, AssistedActionsPanel, resetPendingRequestIds } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { TechPanel } from './TechPanel.js'

beforeEach(() => {
  localStorage.setItem('civ.panel.actions', 'true')
  localStorage.setItem('civ.panel.techs', 'true')
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.actions')
  localStorage.removeItem('civ.panel.techs')
  vi.restoreAllMocks()
})

type Action = NonNullable<PlayerView['you']>['availableActions'][number]

const chivalry = (status: Action['status'], reason: string): Action => ({
  action: 'chivalry',
  label: 'Chivalry',
  status,
  reason,
})

const READY = chivalry('ready', 'Ready to use.')

const tech = (name: string): TechItem => ({
  id: `tech-${name}`,
  name,
  level: 2,
  hidden: false,
  itemNumber: 1,
  description: null,
  used: false,
  ownerId: 'me',
  sheetName: 'LEVEL_2_TECH',
  kind: 'tech',
  type: null,
})

function viewWith(
  actions: readonly Action[],
  rev = 5,
  techsChosen: readonly TechItem[] = [],
  playerId = 'me',
): PlayerView {
  return {
    rev,
    you: {
      playerId,
      username: 'Alice',
      color: 'Red',
      civilization: { name: 'Rome' },
      techsChosen,
      pyramidPlacements: [],
      availableActions: actions,
    },
    opponents: [],
  } as unknown as PlayerView
}

const spectatorView = { rev: 5, you: null, opponents: [] } as unknown as PlayerView

const run: Run = async (action) => {
  // GameView's run reports a failure on screen instead of throwing; so does this.
  try {
    await action()
  } catch {
    /* shown by GameView in the real app */
  }
}

const renderPanel = (view: PlayerView, props: { busy?: boolean; readOnly?: boolean } = {}) =>
  render(
    <AssistedActionsPanel
      gameId="game-1"
      view={view}
      busy={props.busy ?? false}
      readOnly={props.readOnly ?? false}
      run={run}
    />,
  )

describe('AssistedActionsPanel', () => {
  it('shows a ready action with its status and reason, and the button is enabled', () => {
    renderPanel(viewWith([READY]))

    expect(screen.getByRole('heading', { name: /Your actions/ })).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Use Chivalry' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Ready to use.')).toBeTruthy()
  })

  it.each([
    ['used', 'Used', 'Chivalry has already been used this turn.'],
    [
      'needs-resource',
      'Needs resource',
      'You need an Incense token: an Incense hut in your hand or an Incense piece in your player area.',
    ],
    ['wrong-phase', 'Not now', 'Only available during your open City Management phase.'],
  ] as const)('shows why a %s action cannot be pressed, as text on the page', (status, tag, reason) => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([chivalry(status, reason)]))

    const button = screen.getByRole('button', { name: 'Use Chivalry' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText(tag)).toBeTruthy()
    // Visible text that the button points at, not a title attribute.
    const reasonElement = screen.getByText(reason)
    expect(button.getAttribute('aria-describedby')).toBe(reasonElement.id)
    expect(button.getAttribute('title')).toBeNull()
    fireEvent.click(button)
    expect(perform).not.toHaveBeenCalled()
  })

  it('leaves out an action for a card the viewer does not hold, and the whole panel when none is left', () => {
    const { container } = renderPanel(
      viewWith([chivalry('not-owned', 'You do not have Chivalry.')]),
    )

    expect(container.textContent).toBe('')
  })

  it('renders nothing for a spectator', () => {
    const { container } = renderPanel(spectatorView)

    expect(container.textContent).toBe('')
  })

  it('renders nothing when the viewer has no availableActions', () => {
    const { container } = renderPanel(viewWith([]))

    expect(container.textContent).toBe('')
  })

  it('disables the button while another write runs or the game is read-only', () => {
    renderPanel(viewWith([READY]), { busy: true })
    expect((screen.getByRole('button', { name: 'Use Chivalry' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    renderPanel(viewWith([READY]), { readOnly: true })
    expect((screen.getByRole('button', { name: 'Use Chivalry' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does nothing on its own: rendering, and showing the card, never fires an action', () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue({} as PlayerView)
    const { rerender } = renderPanel(viewWith([READY]))
    rerender(
      <AssistedActionsPanel gameId="game-1" view={viewWith([READY], 6)} busy={false} readOnly={false} run={run} />,
    )

    expect(perform).not.toHaveBeenCalled()
  })
})

describe('AssistedActionButton requests', () => {
  it('sends the game, the action, a request id and the revision it saw', async () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([READY], 11))

    fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))

    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    const [gameId, action, requestId, rev] = perform.mock.calls[0]!
    expect([gameId, action, rev]).toEqual(['game-1', 'chivalry', 11])
    expect(requestId.length).toBeGreaterThan(8)
  })

  it('a double click sends one request with one request id', async () => {
    let finish: (view: PlayerView) => void = () => {}
    const perform = vi
      .spyOn(api, 'performAction')
      .mockReturnValue(new Promise<PlayerView>((resolve) => (finish = resolve)))
    renderPanel(viewWith([READY]))

    const button = screen.getByRole('button', { name: 'Use Chivalry' })
    fireEvent.click(button)
    fireEvent.click(button)
    finish({} as PlayerView)

    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    // Settled: the next press is a new press.
    await waitFor(() => {
      fireEvent.click(button)
      expect(perform.mock.calls.length).toBeGreaterThan(1)
    })
    expect(perform.mock.calls[1]![2]).not.toBe(perform.mock.calls[0]![2])
  })

  it('a retry after a failure reuses the request id, and a press after a success gets a new one', async () => {
    const perform = vi
      .spyOn(api, 'performAction')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([READY]))
    const button = screen.getByRole('button', { name: 'Use Chivalry' })

    fireEvent.click(button)
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    // The failed call has settled once the in-flight guard lets the retry through.
    await waitFor(() => {
      fireEvent.click(button)
      expect(perform.mock.calls.length).toBeGreaterThan(1)
    })
    expect(perform.mock.calls).toHaveLength(2)
    expect(perform.mock.calls[1]![2]).toBe(perform.mock.calls[0]![2])

    // That retry succeeded, so this is a new press with a new id.
    await waitFor(() => {
      fireEvent.click(button)
      expect(perform.mock.calls.length).toBeGreaterThan(2)
    })
    expect(perform.mock.calls[2]![2]).not.toBe(perform.mock.calls[1]![2])
  })

  it.each([
    [409, 'STALE_REVISION'],
    [400, 'ACTION_NOT_AVAILABLE'],
  ])('a %i answer frees the request id, so the next press is a new one', async (status, code) => {
    const perform = vi
      .spyOn(api, 'performAction')
      .mockRejectedValueOnce(new ApiError(status, code, 'refused'))
      .mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([READY]))
    const button = screen.getByRole('button', { name: 'Use Chivalry' })

    fireEvent.click(button)
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      fireEvent.click(button)
      expect(perform.mock.calls.length).toBeGreaterThan(1)
    })

    expect(perform.mock.calls[1]![2]).not.toBe(perform.mock.calls[0]![2])
  })

  it('a network failure keeps the request id, and the retry reuses it', async () => {
    const perform = vi
      .spyOn(api, 'performAction')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([READY]))
    const button = screen.getByRole('button', { name: 'Use Chivalry' })

    for (const calls of [1, 2, 3]) {
      await waitFor(() => {
        fireEvent.click(button)
        expect(perform.mock.calls.length).toBeGreaterThanOrEqual(calls)
      })
    }

    expect(perform.mock.calls).toHaveLength(3)
    expect(perform.mock.calls[1]![2]).toBe(perform.mock.calls[0]![2])
    expect(perform.mock.calls[2]![2]).toBe(perform.mock.calls[0]![2])
  })

  it('a different viewer in the same tab gets a different id for the same game and action', async () => {
    const perform = vi
      .spyOn(api, 'performAction')
      .mockRejectedValue(new TypeError('Failed to fetch'))
    const { rerender } = renderPanel(viewWith([READY], 5, [], 'alice-id'))

    fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    // The first press is unsettled in outcome, so its id is still kept for alice-id.
    rerender(
      <AssistedActionsPanel
        gameId="game-1"
        view={viewWith([READY], 5, [], 'bob-id')}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))
      expect(perform.mock.calls.length).toBeGreaterThan(1)
    })

    expect(perform.mock.calls[1]![2]).not.toBe(perform.mock.calls[0]![2])
  })

  it('uses the revision of the render it was pressed in, so a retry after a reload is not stale', async () => {
    const perform = vi
      .spyOn(api, 'performAction')
      .mockRejectedValueOnce(new Error('409'))
      .mockResolvedValue({} as PlayerView)
    const { rerender } = renderPanel(viewWith([READY], 5))

    fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    rerender(
      <AssistedActionsPanel gameId="game-1" view={viewWith([READY], 6)} busy={false} readOnly={false} run={run} />,
    )
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))
      expect(perform.mock.calls.length).toBeGreaterThan(1)
    })

    expect(perform.mock.calls[1]![3]).toBe(6)
    expect(perform.mock.calls[1]![2]).toBe(perform.mock.calls[0]![2])
  })

  it('renders its children as the button text, with the reason only while blocked', () => {
    render(
      <AssistedActionButton
        action="democracy"
        gameId="game-1"
        view={viewWith([
          { action: 'democracy', label: 'Democracy', status: 'ready', reason: 'Spend 6 trade to add 1 coin to Democracy.' },
        ])}
        busy={false}
        readOnly={false}
        run={run}
        detail="blocked"
      >
        Spend 6 trade
      </AssistedActionButton>,
    )

    expect(screen.getByRole('button', { name: 'Spend 6 trade' })).toBeTruthy()
    expect(screen.queryByText(/Spend 6 trade to add/)).toBeNull()
  })
})

describe('the same action from two entry points', () => {
  it('shows the same state in the Your actions panel and in the Chivalry tech dialog', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const reason = 'You need an Incense token: an Incense hut in your hand or an Incense piece in your player area.'
    const view = viewWith([chivalry('needs-resource', reason)], 5, [tech('Chivalry')])
    render(
      <>
        <AssistedActionsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />
        <TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />
      </>,
    )

    const pyramid = document.querySelector<HTMLElement>('.tech-pyramid')!
    fireEvent.click(within(pyramid).getByText('Chivalry'))
    const dialog = screen.getByRole('dialog')

    const inDialog = within(dialog).getByRole('button', { name: 'Use Chivalry' }) as HTMLButtonElement
    expect(inDialog.disabled).toBe(true)
    expect(within(dialog).getByText(reason)).toBeTruthy()
    expect(within(dialog).getByText('Needs resource')).toBeTruthy()
    // The panel behind the dialog says the same.
    const buttons = screen.getAllByRole('button', { name: 'Use Chivalry', hidden: true })
    expect(buttons).toHaveLength(2)
    expect(screen.getAllByText(reason, { exact: true })).toHaveLength(2)
  })

  it('presses the same action, with the same request id, from either entry point', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const perform = vi
      .spyOn(api, 'performAction')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({} as PlayerView)
    const view = viewWith([READY], 5, [tech('Chivalry')])
    render(
      <>
        <AssistedActionsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />
        <TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    fireEvent.click(within(document.querySelector<HTMLElement>('.tech-pyramid')!).getByText('Chivalry'))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Use Chivalry' }))
      expect(perform.mock.calls.length).toBeGreaterThan(1)
    })

    expect(perform.mock.calls[1]![2]).toBe(perform.mock.calls[0]![2])
  })

  it('offers no Chivalry button in the dialog for a spectator or for another player\'s tech', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const view = {
      rev: 5,
      you: null,
      opponents: [
        {
          playerId: 'them',
          username: 'Bob',
          color: 'Blue',
          civilization: { name: 'Egypt' },
          revealedTechs: [tech('Chivalry')],
          numberOfTechsChosen: 1,
          pyramidPlacements: [],
        },
      ],
    } as unknown as PlayerView
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)

    fireEvent.click(within(document.querySelector<HTMLElement>('.tech-pyramid')!).getByText('Chivalry'))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use Chivalry' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The culture advance and its card choice
// ---------------------------------------------------------------------------

const advance = (status: Action['status'], reason: string): Action => ({
  action: 'cultureAdvance',
  label: 'Culture advance',
  status,
  reason,
})

type Reward = NonNullable<PlayerView['you']>['pendingRewards'][number]

const card = (id: string, name: string, kind: 'cultureII' | 'greatperson' = 'cultureII') =>
  ({
    id,
    name,
    kind,
    sheetName: kind === 'cultureII' ? 'CULTURE_2' : 'GREAT_PERSON',
    level: 2,
    hidden: false,
    itemNumber: 7,
    description: null,
    used: false,
    ownerId: 'me',
    type: null,
  }) as unknown as Reward['candidates'][number]

const reward = (kind: Reward['kind'] = 'event', id = 'adv-1'): Reward => ({
  id,
  kind,
  level: 2,
  step: 9,
  keep: 1,
  candidates:
    kind === 'event'
      ? [card('c1', 'Hanging Gardens Festival'), card('c2', 'Library Fire')]
      : [card('g1', 'Isaac Newton', 'greatperson'), card('g2', 'Sun Tzu', 'greatperson')],
})

const viewWithRewards = (
  rewards: readonly Reward[],
  actions: readonly Action[] = [],
  rev = 5,
): PlayerView => {
  const base = viewWith(actions, rev)
  return { ...base, you: { ...base.you!, pendingRewards: rewards } } as PlayerView
}

describe('the Advance culture button', () => {
  const READY_REASON = 'Advance to space 9 (culture II event): 5 culture and 3 trade.'

  it('shows when it is the only action in the panel, with its reason as text', () => {
    renderPanel(viewWith([advance('ready', READY_REASON)]))

    const button = screen.getByRole('button', { name: 'Advance culture' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.getByText(READY_REASON)).toBeTruthy()
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByText(READY_REASON).id)
  })

  it.each([
    ['needs-resource', 'Needs resource', 'Advance to space 9 (culture II event): 5 culture and 3 trade. You are missing 2 culture.'],
    ['wrong-phase', 'Not now', 'Only available during your open City Management phase.'],
    [
      'unavailable',
      'Unavailable',
      'Advance to space 9 (culture II event): 5 culture and 3 trade. Choose the card to keep from your last advance first.',
    ],
    ['unavailable', 'Unavailable', 'Your leader marker is not on the culture track.'],
    ['unavailable', 'Unavailable', 'Your marker is already on the Culture Victory space.'],
  ] as const)('a %s advance cannot be pressed and says why: %s', (status, tag, reason) => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([advance(status, reason)]))

    const button = screen.getByRole('button', { name: 'Advance culture' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText(tag)).toBeTruthy()
    expect(screen.getByText(reason)).toBeTruthy()
    fireEvent.click(button)
    expect(perform).not.toHaveBeenCalled()
  })

  it('sends one request with a new id, and a second press after a success sends another id', async () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([advance('ready', READY_REASON)], 8))
    const button = screen.getByRole('button', { name: 'Advance culture' })

    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    expect(perform.mock.calls[0]!.slice(0, 2)).toEqual(['game-1', 'cultureAdvance'])
    expect(perform.mock.calls[0]![3]).toBe(8)

    await waitFor(() => {
      fireEvent.click(button)
      expect(perform.mock.calls.length).toBeGreaterThan(1)
    })
    expect(perform.mock.calls[1]![2]).not.toBe(perform.mock.calls[0]![2])
  })
})

describe('the pending card choice', () => {
  it('shows the candidate cards with their names and one Keep button each', () => {
    renderPanel(viewWithRewards([reward()]))

    expect(screen.getByRole('heading', { name: 'Choose a card to keep' })).toBeTruthy()
    expect(screen.getByText('Hanging Gardens Festival')).toBeTruthy()
    expect(screen.getByText('Library Fire')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Keep this card.*Hanging Gardens Festival/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Keep this card.*Library Fire/ })).toBeTruthy()
    expect(screen.getByText(/The other cards are discarded/)).toBeTruthy()
    // A culture event says nothing about Great Person tokens.
    expect(screen.queryByText(/Great Person tokens/)).toBeNull()
  })

  it('shows the same candidates again when the page is loaded afresh from the projection', () => {
    const view = viewWithRewards([reward()])
    const first = renderPanel(view)
    const before = first.container.textContent
    first.unmount()
    localStorage.setItem('civ.panel.actions', 'true')
    const second = renderPanel(JSON.parse(JSON.stringify(view)) as PlayerView)

    expect(second.container.textContent).toBe(before)
    expect(screen.getAllByRole('button', { name: /Keep this card/ })).toHaveLength(2)
  })

  it('says Great Person tokens are still handled by hand for a Great Person reward', () => {
    renderPanel(viewWithRewards([reward('greatPerson')]))

    expect(screen.getByText(/Great Person tokens are still handled by hand/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Keep this card.*Isaac Newton/ })).toBeTruthy()
  })

  it('shows only the first pending reward', () => {
    renderPanel(viewWithRewards([reward('event', 'adv-1'), reward('greatPerson', 'adv-2')]))

    expect(screen.getByText('Library Fire')).toBeTruthy()
    expect(screen.queryByText('Isaac Newton')).toBeNull()
  })

  it('renders no choice for a view without pending rewards, and the panel stays away when nothing else is listed', () => {
    const { container } = renderPanel(viewWithRewards([]))
    expect(container.textContent).toBe('')
    cleanup()
    renderPanel(viewWith([advance('ready', 'Advance.')]))
    expect(screen.queryByText('Choose a card to keep')).toBeNull()
  })

  it('shows the choice even when no action is listed, next to the blocked advance reason', () => {
    const reason = 'Advance to space 9 (culture II event): 5 culture and 3 trade. Choose the card to keep from your last advance first.'
    renderPanel(viewWithRewards([reward()], [advance('unavailable', reason)]))

    expect(screen.getByText(reason)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Advance culture' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('heading', { name: 'Choose a card to keep' })).toBeTruthy()
  })

  it('sends chooseReward with the game, reward, card, a request id and the revision', async () => {
    const choose = vi.spyOn(api, 'chooseReward').mockResolvedValue({} as PlayerView)
    renderPanel(viewWithRewards([reward()], [], 12))

    fireEvent.click(screen.getByRole('button', { name: /Keep this card.*Library Fire/ }))

    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1))
    const [gameId, rewardId, itemId, requestId, rev] = choose.mock.calls[0]!
    expect([gameId, rewardId, itemId, rev]).toEqual(['game-1', 'adv-1', 'c2', 12])
    expect(requestId.length).toBeGreaterThan(8)
  })

  it('a double click sends one request, also when the second click is on the other card', async () => {
    let finish: (view: PlayerView) => void = () => {}
    const choose = vi
      .spyOn(api, 'chooseReward')
      .mockReturnValue(new Promise<PlayerView>((resolve) => (finish = resolve)))
    renderPanel(viewWithRewards([reward()]))
    const first = screen.getByRole('button', { name: /Keep this card.*Hanging Gardens/ })
    const second = screen.getByRole('button', { name: /Keep this card.*Library Fire/ })

    fireEvent.click(first)
    fireEvent.click(first)
    fireEvent.click(second)

    expect(choose).toHaveBeenCalledTimes(1)
    // Both buttons are disabled while the request is in flight.
    expect((first as HTMLButtonElement).disabled).toBe(true)
    expect((second as HTMLButtonElement).disabled).toBe(true)
    finish({} as PlayerView)
    await waitFor(() => expect((first as HTMLButtonElement).disabled).toBe(false))
  })

  it('a 409 frees the id: the next press of the same card sends a new one', async () => {
    const choose = vi
      .spyOn(api, 'chooseReward')
      .mockRejectedValueOnce(new ApiError(409, 'STALE_REVISION', 'stale'))
      .mockResolvedValue({} as PlayerView)
    renderPanel(viewWithRewards([reward()]))
    const button = screen.getByRole('button', { name: /Keep this card.*Library Fire/ })

    fireEvent.click(button)
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      fireEvent.click(button)
      expect(choose.mock.calls.length).toBeGreaterThan(1)
    })

    expect(choose.mock.calls[1]![3]).not.toBe(choose.mock.calls[0]![3])
  })

  it('a refused card and then another card are two presses with two ids', async () => {
    const choose = vi
      .spyOn(api, 'chooseReward')
      .mockRejectedValueOnce(new ApiError(400, 'ACTION_NOT_AVAILABLE', 'no'))
      .mockResolvedValue({} as PlayerView)
    renderPanel(viewWithRewards([reward()]))

    fireEvent.click(screen.getByRole('button', { name: /Keep this card.*Library Fire/ }))
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /Keep this card.*Hanging Gardens/ }))
      expect(choose.mock.calls.length).toBeGreaterThan(1)
    })

    expect(choose.mock.calls[1]![2]).toBe('c1')
    expect(choose.mock.calls[1]![3]).not.toBe(choose.mock.calls[0]![3])
  })

  it('a lost response (TypeError) keeps the id, and the retry of the same card reuses it', async () => {
    const choose = vi
      .spyOn(api, 'chooseReward')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({} as PlayerView)
    renderPanel(viewWithRewards([reward()]))
    const button = screen.getByRole('button', { name: /Keep this card.*Library Fire/ })

    fireEvent.click(button)
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      fireEvent.click(button)
      expect(choose.mock.calls.length).toBeGreaterThan(1)
    })

    expect(choose.mock.calls[1]![3]).toBe(choose.mock.calls[0]![3])
  })

  it('has no choice for a spectator, and no active button while the game is read-only', () => {
    const { container } = renderPanel({ ...spectatorView, pendingRewards: [reward()] } as unknown as PlayerView)
    expect(container.textContent).toBe('')
    cleanup()

    const choose = vi.spyOn(api, 'chooseReward').mockResolvedValue({} as PlayerView)
    renderPanel(viewWithRewards([reward()]), { readOnly: true })
    const button = screen.getByRole('button', { name: /Keep this card.*Library Fire/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(choose).not.toHaveBeenCalled()
  })
})
