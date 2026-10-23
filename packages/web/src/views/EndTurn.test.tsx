// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TurnPhase } from '@civ/engine'

import { ApiError, api } from '../lib/api.js'
import type { ActiveTurnStatus, PlayerView } from '../lib/api.js'
import { hasActionsPanel, resetPendingRequestIds } from './AssistedActions.js'
import { AssistedActionsPanel } from './panelForTests.js'
import { endTurnState } from './EndTurn.js'
import type { Run } from './GameView.js'

beforeEach(() => {
  localStorage.setItem('civ.panel.actions', 'true')
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.actions')
  vi.restoreAllMocks()
})

type Waiting = ActiveTurnStatus['waitingFor'][number]

const activeTurn = (turnNumber: number, waitingFor: readonly Waiting[]): ActiveTurnStatus => ({
  playerId: 'me',
  username: 'Alice',
  turnNumber,
  phase: waitingFor[0]?.phase ?? 'SOT',
  waitingFor,
  startPlayer: 'Alice',
})

const alice = (phase: TurnPhase): Waiting => ({ username: 'Alice', phase })
const bob = (phase: TurnPhase): Waiting => ({ username: 'Bob', phase })

function viewIn(turn: ActiveTurnStatus | null, extra: Record<string, unknown> = {}): PlayerView {
  return {
    rev: 5,
    active: true,
    you: {
      playerId: 'me',
      username: 'Alice',
      color: 'Red',
      civilization: { name: 'Rome' },
      techsChosen: [],
      pyramidPlacements: [],
      availableActions: [],
    },
    opponents: [],
    activeTurn: turn,
    ...extra,
  } as unknown as PlayerView
}

const spectator = { rev: 5, active: true, you: null, opponents: [], activeTurn: activeTurn(4, [bob('CM')]) } as unknown as PlayerView

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

describe('endTurnState', () => {
  it('is the first phase the viewer has open, in the active turn', () => {
    expect(endTurnState(viewIn(activeTurn(4, [alice('CM'), bob('CM')])))).toEqual({
      kind: 'open',
      turnNumber: 4,
      phase: 'CM',
    })
  })

  it('is the viewer’s own phase even when another player is further behind', () => {
    expect(endTurnState(viewIn(activeTurn(4, [bob('TRADE'), alice('MOVEMENT')])))).toEqual({
      kind: 'open',
      turnNumber: 4,
      phase: 'MOVEMENT',
    })
  })

  it('is done once the viewer is no longer waited for', () => {
    expect(endTurnState(viewIn(activeTurn(4, [bob('RESEARCH')])))).toEqual({ kind: 'done', turnNumber: 4 })
  })

  it.each([
    ['a spectator', spectator],
    ['a game that has not started', viewIn(null)],
    ['a view without an active turn', viewIn(undefined as unknown as null)],
    ['a game that has ended', viewIn(activeTurn(4, [alice('CM')]), { active: false })],
  ])('is null for %s', (_what, view) => {
    expect(endTurnState(view)).toBeNull()
  })
})

describe('End turn in Your actions', () => {
  it('is enough for the panel to show, for a player with no action, choice or city', () => {
    const view = viewIn(activeTurn(4, [alice('CM'), bob('CM')]))
    expect(hasActionsPanel(view)).toBe(true)

    renderPanel(view)

    const panel = screen.getByRole('group', { name: 'Your actions' })
    const button = within(panel).getByRole('button', { name: 'End turn: mark City management as done' })
    expect(button.textContent).toBe('End turn')
    // The accessible name starts with the visible label (WCAG 2.5.3)
    expect(button.getAttribute('aria-label')?.startsWith(button.textContent ?? '')).toBe(true)
    expect(within(panel).getByText('Turn 4: marks your city management phase done.')).toBeTruthy()
  })

  it('marks the viewer’s phase of the turn they saw done, and nothing else', async () => {
    const markDone = vi.spyOn(api, 'markDone').mockResolvedValue({} as PlayerView)
    const unmarkDone = vi.spyOn(api, 'unmarkDone').mockResolvedValue({} as PlayerView)
    renderPanel(viewIn(activeTurn(4, [alice('CM'), bob('CM')])))

    fireEvent.click(screen.getByRole('button', { name: 'End turn: mark City management as done' }))

    await waitFor(() => expect(markDone).toHaveBeenCalledExactlyOnceWith('game-1', 'CM', 4))
    expect(unmarkDone).not.toHaveBeenCalled()
  })

  it('shows the error through the page’s run, and does not throw, when the server refuses', async () => {
    vi.spyOn(api, 'markDone').mockRejectedValue(new ApiError(403, 'NO_ACCESS', 'No access'))
    const shown: unknown[] = []
    const reporting: Run = async (action) => {
      try {
        await action()
      } catch (caught) {
        shown.push(caught)
      }
    }
    render(
      <AssistedActionsPanel
        gameId="game-1"
        view={viewIn(activeTurn(4, [alice('SOT')]))}
        busy={false}
        readOnly={false}
        run={reporting}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'End turn: mark Start of turn as done' }))

    await waitFor(() => expect(shown).toHaveLength(1))
    expect(shown[0]).toBeInstanceOf(ApiError)
  })

  it.each([
    ['busy', { busy: true }],
    ['read only (a replay, which keeps its active turn)', { readOnly: true }],
  ])('cannot be pressed while the page is %s', (_why, props) => {
    const markDone = vi.spyOn(api, 'markDone').mockResolvedValue({} as PlayerView)
    renderPanel(viewIn(activeTurn(4, [alice('CM')])), props)

    const button = screen.getByRole('button', { name: /^End turn/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(markDone).not.toHaveBeenCalled()
  })

  it('on Research says that ending it is what starts the next turn', () => {
    renderPanel(viewIn(activeTurn(4, [alice('RESEARCH'), bob('RESEARCH')])))

    expect(screen.getByRole('button', { name: 'End turn: mark Research as done' })).toBeTruthy()
    expect(
      screen.getByText(
        'Turn 4: marks your research phase done. The next turn starts when every player has ended their research phase.',
      ),
    ).toBeTruthy()
  })

  it('does not mention the next turn on an earlier phase', () => {
    renderPanel(viewIn(activeTurn(4, [alice('MOVEMENT')])))

    expect(document.body.textContent).not.toContain('next turn starts')
  })

  it('once the viewer is done, has no button and says who is waited for', () => {
    renderPanel(viewIn(activeTurn(4, [bob('MOVEMENT')])))

    expect(screen.queryByRole('button', { name: /^End turn/ })).toBeNull()
    expect(screen.getByText('You have ended turn 4. Waiting for Bob (movement).')).toBeTruthy()
  })

  it('moves focus to the line that replaces the button after the last press, so it is not lost', () => {
    const { rerender } = renderPanel(viewIn(activeTurn(4, [alice('RESEARCH'), bob('RESEARCH')])))
    const button = screen.getByRole('button', { name: 'End turn: mark Research as done' })
    button.focus()
    expect(document.activeElement).toBe(button)

    rerender(
      <AssistedActionsPanel
        gameId="game-1"
        view={viewIn(activeTurn(4, [bob('RESEARCH')]))}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(document.activeElement).toBe(screen.getByText(/^You have ended turn 4\./))
  })

  it('leaves focus alone when the turn is ended somewhere else and the viewer is typing here', () => {
    const { rerender } = render(
      <>
        <input aria-label="Elsewhere" />
        <AssistedActionsPanel
          gameId="game-1"
          view={viewIn(activeTurn(4, [alice('RESEARCH'), bob('RESEARCH')]))}
          busy={false}
          readOnly={false}
          run={run}
        />
      </>,
    )
    const input = screen.getByLabelText('Elsewhere')
    input.focus()

    rerender(
      <>
        <input aria-label="Elsewhere" />
        <AssistedActionsPanel
          gameId="game-1"
          view={viewIn(activeTurn(4, [bob('RESEARCH')]))}
          busy={false}
          readOnly={false}
          run={run}
        />
      </>,
    )

    expect(document.activeElement).toBe(input)
  })

  it('does not take focus when the panel first shows a viewer who is already done', () => {
    renderPanel(viewIn(activeTurn(4, [bob('MOVEMENT')])))

    expect(document.activeElement).toBe(document.body)
  })

  it('comes before the action list, which is only there for a card the viewer holds', () => {
    const view = viewIn(activeTurn(4, [alice('CM')]))
    ;(view.you as { availableActions: unknown }).availableActions = [
      { action: 'chivalry', label: 'Chivalry', phase: 'CM', group: 'Resource abilities', status: 'ready', reason: 'Ready to use.' },
    ]

    renderPanel(view)

    const panel = screen.getByRole('group', { name: 'Your actions' })
    const endTurn = within(panel).getByRole('button', { name: /^End turn/ })
    const chivalry = within(panel).getByRole('button', { name: 'Use Chivalry' })
    expect(endTurn.compareDocumentPosition(chivalry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not there for a spectator, a game that has not started, or one that has ended', () => {
    for (const view of [spectator, viewIn(null), viewIn(activeTurn(4, [alice('CM')]), { active: false })]) {
      const { container } = renderPanel(view)
      expect(container.textContent).toBe('')
      expect(hasActionsPanel(view)).toBe(false)
      cleanup()
    }
  })
})

describe('Reopen in Your actions', () => {
  const withDone = (turn: ActiveTurnStatus, turnNumber: number, done: Partial<Record<TurnPhase, boolean>>) =>
    viewIn(turn, {
      you: {
        playerId: 'me',
        username: 'Alice',
        color: 'Red',
        civilization: { name: 'Rome' },
        techsChosen: [],
        pyramidPlacements: [],
        availableActions: [],
        playerTurns: [{ turnNumber, done }],
      },
    })

  it('takes back the phase the viewer ended last, once they are done, and nothing else', async () => {
    const unmarkDone = vi.spyOn(api, 'unmarkDone').mockResolvedValue({} as PlayerView)
    const markDone = vi.spyOn(api, 'markDone').mockResolvedValue({} as PlayerView)
    renderPanel(
      withDone(activeTurn(4, [bob('TRADE')]), 4, {
        SOT: true, CM: true, MOVEMENT: true, TRADE: true, RESEARCH: true,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reopen: mark Research as not done' }))

    await waitFor(() => expect(unmarkDone).toHaveBeenCalledExactlyOnceWith('game-1', 'RESEARCH', 4))
    expect(markDone).not.toHaveBeenCalled()
  })

  it('offers the phase before the open one, and says a later ended phase stays ended', () => {
    renderPanel(withDone(activeTurn(4, [alice('CM'), bob('TRADE')]), 4, { SOT: true, MOVEMENT: true }))

    expect(screen.getByRole('button', { name: 'Reopen: mark Start of turn as not done' })).toBeTruthy()
    expect(
      screen.getByText('Reopened: your city management phase is open again. Your movement phase stays ended.'),
    ).toBeTruthy()
    // End turn still ends the phase that is open, not the later one
    expect(screen.getByRole('button', { name: 'End turn: mark City management as done' })).toBeTruthy()
  })

  it('offers the ended phase without a note on a normal turn, and nothing when none is ended', () => {
    renderPanel(withDone(activeTurn(4, [alice('CM')]), 4, { SOT: true }))

    expect(screen.getByRole('button', { name: /^Reopen/ })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Reopened:')
    cleanup()
    renderPanel(viewIn(activeTurn(4, [alice('SOT')])))
    expect(screen.queryByRole('button', { name: /^Reopen/ })).toBeNull()
  })

  it('cannot be pressed while the page is busy', () => {
    const unmarkDone = vi.spyOn(api, 'unmarkDone').mockResolvedValue({} as PlayerView)
    renderPanel(withDone(activeTurn(4, [alice('CM')]), 4, { SOT: true }), { busy: true })

    const button = screen.getByRole('button', { name: /^Reopen/ }) as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    expect(unmarkDone).not.toHaveBeenCalled()
  })
})
