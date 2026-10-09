// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
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

function viewWith(actions: readonly Action[], rev = 5, techsChosen: readonly TechItem[] = []): PlayerView {
  return {
    rev,
    you: {
      playerId: 'me',
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
