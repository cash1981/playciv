// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { goToPanel } from './PhaseSummary.js'
import { PHASE_GUIDE, PhaseActionsPanel, currentPhaseOf, phaseStatusText } from './PhaseTabs.js'

const originalScrollIntoView = Element.prototype.scrollIntoView

beforeEach(() => {
  localStorage.setItem('civ.panel.actions', 'true')
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  Element.prototype.scrollIntoView = originalScrollIntoView
  localStorage.removeItem('civ.panel.actions')
  vi.restoreAllMocks()
})

type Action = NonNullable<PlayerView['you']>['availableActions'][number]

const chivalry: Action = {
  action: 'chivalry',
  label: 'Chivalry',
  phase: 'CM',
  group: 'Resource abilities',
  status: 'ready',
  reason: 'Ready to use.',
  repeatable: true,
}
const advance: Action = {
  action: 'cultureAdvance',
  label: 'Culture advance',
  phase: 'CM',
  group: 'Culture track',
  status: 'ready',
  reason: 'Advance to space 1.',
  repeatable: true,
}

type Phase = 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT' | 'RESEARCH'

function viewIn(
  phase: Phase | null,
  actions: readonly Action[] = [chivalry, advance],
  extra: Record<string, unknown> = {},
): PlayerView {
  return {
    rev: 4,
    you: {
      playerId: 'me',
      username: 'Alice',
      cities: [],
      stats: { trade: 0 },
      availableActions: actions,
      pendingRewards: [],
      techsChosen: [],
      pyramidPlacements: [],
      ...extra,
    },
    activeTurn: {
      turnNumber: 3,
      waitingFor: phase === null ? [] : [{ username: 'Alice', phase }],
    },
    opponents: [],
  } as unknown as PlayerView
}

const run: Run = async (action) => {
  await action()
}

const renderPanel = (view: PlayerView, props: { readOnly?: boolean } = {}) =>
  render(
    <PhaseActionsPanel
      gameId="g1"
      view={view}
      busy={false}
      readOnly={props.readOnly ?? false}
      run={run}
    />,
  )

const tab = (name: RegExp): HTMLElement => screen.getByRole('tab', { name })
const selected = (): string =>
  within(screen.getByRole('tablist', { name: 'Phases of the turn' }))
    .getAllByRole('tab')
    .filter((candidate) => candidate.getAttribute('aria-selected') === 'true')
    .map((candidate) => candidate.textContent)
    .join('|')

describe('the phase tabs', () => {
  it('has one tab for each of the five phases, in turn order', () => {
    renderPanel(viewIn('SOT'))
    expect(screen.getAllByRole('tab').map((candidate) => candidate.textContent?.replace(/ \((now|done)\)/g, ''))).toEqual([
      'Start of turn',
      'Trade',
      'City management',
      'Movement',
      'Research',
    ])
    expect(screen.getByRole('tablist', { name: 'Phases of the turn' })).toBeTruthy()
  })

  it('opens the tab of the phase the viewer is in, and says which ones are done', () => {
    renderPanel(viewIn('CM'))
    expect(selected()).toBe('City management (now)')
    expect(tab(/^Start of turn/).textContent).toContain('(done)')
    expect(tab(/^Trade/).textContent).toContain('(done)')
    expect(tab(/^Movement/).textContent).not.toContain('(done)')
    expect(screen.getByText('This is your current phase.')).toBeTruthy()
  })

  it('opens Start of turn when the viewer has no phase waiting, and says every phase is finished', () => {
    renderPanel(viewIn(null))
    expect(selected()).toBe('Start of turn (done)')
    expect(screen.getByText('You have finished every phase of this turn.')).toBeTruthy()
  })

  it('shows what the open phase is for', () => {
    renderPanel(viewIn('SOT'))
    expect(screen.getByText(PHASE_GUIDE.SOT)).toBeTruthy()
    fireEvent.click(tab(/^Movement/))
    expect(screen.getByText(PHASE_GUIDE.MOVEMENT)).toBeTruthy()
    expect(screen.queryByText(PHASE_GUIDE.SOT)).toBeNull()
  })

  it('lets any tab be opened, and says whether the phase is over or still to come', () => {
    renderPanel(viewIn('TRADE'))
    fireEvent.click(tab(/^Start of turn/))
    expect(screen.getByText('You have finished this phase.')).toBeTruthy()
    fireEvent.click(tab(/^Research/))
    expect(
      screen.getByText('Not yet: you are in trade. This phase opens when you mark the earlier ones done.'),
    ).toBeTruthy()
  })

  it('keeps the existing actions in City Management and nowhere else', () => {
    renderPanel(viewIn('CM'))
    expect(screen.getByRole('button', { name: 'Use Chivalry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Advance culture' })).toBeTruthy()
    for (const name of [/^Start of turn/, /^Trade/, /^Movement/, /^Research/]) {
      fireEvent.click(tab(name))
      expect(screen.queryByRole('button', { name: 'Use Chivalry' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Advance culture' })).toBeNull()
    }
    fireEvent.click(tab(/^City management/))
    expect(screen.getByRole('button', { name: 'Use Chivalry' })).toBeTruthy()
  })

  it('groups the City Management actions under their headings', () => {
    renderPanel(viewIn('CM'))
    const tabPanel = screen.getByRole('tabpanel')
    expect(within(tabPanel).getByRole('heading', { name: 'Resource abilities' })).toBeTruthy()
    expect(within(tabPanel).getByRole('heading', { name: 'Culture track' })).toBeTruthy()
    expect(within(tabPanel).getByRole('heading', { name: 'Your cities' })).toBeTruthy()
  })

  it('follows the viewer to the next phase, and stays where it is when the phase does not change', () => {
    const { rerender } = renderPanel(viewIn('SOT'))
    expect(selected()).toBe('Start of turn (now)')
    fireEvent.click(tab(/^Research/))
    rerender(
      <PhaseActionsPanel gameId="g1" view={viewIn('SOT', [], { rev: 5 })} busy={false} readOnly={false} run={run} />,
    )
    expect(selected()).toBe('Research')

    rerender(<PhaseActionsPanel gameId="g1" view={viewIn('TRADE')} busy={false} readOnly={false} run={run} />)
    expect(selected()).toBe('Trade (now)')
  })

  it('moves between tabs with the arrow keys, Home and End', () => {
    renderPanel(viewIn('SOT'))
    fireEvent.keyDown(tab(/^Start of turn/), { key: 'ArrowRight' })
    expect(selected()).toBe('Trade')
    expect(document.activeElement).toBe(tab(/^Trade/))
    fireEvent.keyDown(tab(/^Trade/), { key: 'End' })
    expect(selected()).toBe('Research')
    fireEvent.keyDown(tab(/^Research/), { key: 'ArrowRight' })
    expect(selected()).toBe('Start of turn (now)')
    fireEvent.keyDown(tab(/^Start of turn/), { key: 'ArrowLeft' })
    expect(selected()).toBe('Research')
    fireEvent.keyDown(tab(/^Research/), { key: 'Home' })
    expect(selected()).toBe('Start of turn (now)')
  })

  it('has exactly one tab in the tab order, the selected one', () => {
    renderPanel(viewIn('CM'))
    const focusable = screen.getAllByRole('tab').filter((candidate) => candidate.getAttribute('tabindex') === '0')
    expect(focusable).toHaveLength(1)
    expect(focusable[0]).toBe(tab(/^City management/))
  })

  it('links each tab to its panel', () => {
    renderPanel(viewIn('CM'))
    const open = tab(/^City management/)
    const panel = screen.getByRole('tabpanel')
    expect(open.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(open.id)
  })

  it('shows the waiting card choice above the tabs, whichever tab is open', () => {
    const reward = {
      id: 'adv-1',
      kind: 'event',
      level: 1,
      step: 2,
      keep: 1,
      candidates: [
        { id: 'c1', kind: 'cultureI', name: 'Library Fire', hidden: false, sheetName: 'CULTURE_1', itemNumber: 1, description: null, used: false, ownerId: 'me' },
      ],
    }
    renderPanel(viewIn('SOT', [], { pendingRewards: [reward] }))
    expect(selected()).toBe('Start of turn (now)')
    expect(screen.getByRole('heading', { name: 'Choose a card to keep' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Your actions \(1 choice waiting\)/ })).toBeTruthy()
  })

  it('lists the cards that can be played in the open phase, and the any-time ones in every tab', () => {
    const counterfeiters = {
      itemId: 'c1',
      name: 'Counterfeiters',
      kind: 'culture',
      description: 'Start of Turn: Choose another player.',
      timings: ['SOT'],
      targets: { kind: 'players', min: 1, max: 1 },
      prompt: 'Which player discards a coin token?',
      resources: [],
      discards: true,
      status: 'ready',
      reason: 'Can be played in start of turn, which you are in.',
    }
    const bread = {
      ...counterfeiters,
      itemId: 'c2',
      name: 'Bread and Circuses',
      description: 'Any Time: Cancel a culture event targeting you.',
      timings: ['ANY'],
    }
    renderPanel(viewIn('SOT', [], { playableCards: [counterfeiters, bread] }))
    expect(screen.getByRole('button', { name: 'Play Counterfeiters' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play Bread and Circuses' })).toBeTruthy()
    for (const name of [/^Trade/, /^City management/, /^Movement/, /^Research/]) {
      fireEvent.click(tab(name))
      expect(screen.queryByRole('button', { name: 'Play Counterfeiters' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Play Bread and Circuses' })).toBeTruthy()
    }
  })

  it('puts the policy buttons and the government and investment choices in Start of turn only', () => {
    const expansionism: Action = {
      action: 'expansionism',
      label: 'Expansionism',
      phase: 'SOT',
      group: 'Social policies',
      status: 'ready',
      reason: 'Gain 2 trade: 1 for each of your 2 cities and 1 for each of your 0 city-states.',
      repeatable: false,
    }
    const startOfTurn = {
      government: { status: 'ready', reason: 'You may change government once in your Start of Turn.', current: 'Despotism', options: [], canEnterAnarchy: true },
      feudalism: null,
      invest: {
        status: 'ready',
        reason: 'Invest one coin token this turn.',
        coins: [{ key: 'sheet', label: 'Sheet', coins: 1 }],
        cards: [{ key: 'infra', label: 'Infrastructure', ability: 'Your cities produce +1/+2/+3 production.', thresholds: [1, 2, 3], markers: 0 }],
        totalCoins: 1,
      },
      cityLimit: { have: 2, max: 2 },
      cities: [],
      scouts: [],
      techGrants: [],
    }
    renderPanel(viewIn('SOT', [expansionism, chivalry], { startOfTurn }))
    expect(screen.getByRole('button', { name: 'Use Expansionism' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Social policies' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Change government' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Invest a coin' })).toBeTruthy()
    // The City Management ability is not in this tab
    expect(screen.queryByRole('button', { name: 'Use Chivalry' })).toBeNull()
    fireEvent.click(tab(/^City management/))
    expect(screen.queryByRole('button', { name: 'Use Expansionism' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Change government' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Invest a coin' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Use Chivalry' })).toBeTruthy()
  })

  it('renders nothing for a spectator', () => {
    const { container } = renderPanel({ rev: 1, you: null, activeTurn: null, opponents: [] } as unknown as PlayerView)
    expect(container.textContent).toBe('')
  })

  it('keeps a replay or a locked game from ordering anything in the cities or pressing an action', () => {
    renderPanel(viewIn('CM'), { readOnly: true })
    expect(screen.getByRole('heading', { name: 'Your cities' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Build/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Start Building Program/ })).toBeNull()
    expect((screen.getByRole('button', { name: 'Use Chivalry' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    renderPanel(viewIn('CM'))
    expect((screen.getByRole('button', { name: 'Use Chivalry' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('marks no phase done before the game has started', () => {
    renderPanel({ ...viewIn('SOT'), activeTurn: null } as unknown as PlayerView)
    expect(screen.getByText('Waiting for players')).toBeTruthy()
    expect(screen.queryByText('(done)', { exact: false })).toBeNull()
    expect(screen.getByText('The game has not started yet. The phases open when it does.')).toBeTruthy()
  })

  it('names whose turn it is under the title', () => {
    renderPanel(viewIn('CM'))
    expect(screen.getByText('Turn 3 · Your turn — city management phase')).toBeTruthy()
    cleanup()
    const behind = viewIn('CM')
    ;(behind.activeTurn as { waitingFor: unknown }).waitingFor = [
      { username: 'Bob', phase: 'SOT' },
      { username: 'Alice', phase: 'CM' },
    ]
    renderPanel(behind)
    expect(screen.getByText("Turn 3 · Bob's turn — start of turn phase")).toBeTruthy()
  })

  it('asks before an action out of turn, and a no sends nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const behind = viewIn('CM')
    ;(behind.activeTurn as { waitingFor: unknown }).waitingFor = [
      { username: 'Bob', phase: 'SOT' },
      { username: 'Alice', phase: 'CM' },
    ]
    renderPanel(behind)
    fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))
    expect(confirm).toHaveBeenCalledWith('It is not your turn. Bob is up. Do it anyway?')
    expect(fetchSpy).not.toHaveBeenCalled()
    cleanup()
    confirm.mockClear()
    renderPanel(viewIn('CM'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Chivalry' }))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('puts focus on the panel when the control that had it goes away', () => {
    const { rerender } = renderPanel(viewIn('CM'))
    const again = (view: PlayerView) =>
      rerender(<PhaseActionsPanel gameId="g1" view={view} busy={false} readOnly={false} run={run} />)
    const button = screen.getByRole('button', { name: 'Use Chivalry' })
    button.focus()
    // A press changes the page before the answer comes (the button is disabled while busy): that is a render
    again(viewIn('CM', [chivalry, advance], { rev: 5 }))
    expect(document.activeElement).toBe(button)
    again(viewIn('CM', [advance], { rev: 6 }))
    expect(screen.queryByRole('button', { name: 'Use Chivalry' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Your actions' }))
  })

  it('does not take focus after a click elsewhere on the page ended it in the panel', () => {
    const { rerender } = renderPanel(viewIn('CM'))
    screen.getByRole('button', { name: 'Use Chivalry' }).focus()
    fireEvent.pointerDown(document.body)
    ;(document.activeElement as HTMLElement).blur()
    rerender(<PhaseActionsPanel gameId="g1" view={viewIn('CM', [advance], { rev: 6 })} busy={false} readOnly={false} run={run} />)
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves focus alone when it was not in the panel', () => {
    const { rerender } = renderPanel(viewIn('CM'))
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    rerender(<PhaseActionsPanel gameId="g1" view={viewIn('CM', [advance], { rev: 6 })} busy={false} readOnly={false} run={run} />)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

describe('a free tech arriving', () => {
  // Trade is the open tab, so the Research tab (and its Tech panel) is initially unmounted.
  const withGrants = (count: number): PlayerView =>
    viewIn('TRADE', [], {
      startOfTurn: {
        techGrants: Array.from({ length: count }, (_, index) => ({ id: `g${index}`, source: 'Atlantis', level: null })),
      },
    })

  const renderGrants = (view: PlayerView) => {
    const rendered = render(
      <PhaseActionsPanel gameId="g1" view={view} busy={false} readOnly={false} run={run} />,
    )
    return { ...rendered, again: (next: PlayerView) => rendered.rerender(
      <PhaseActionsPanel gameId="g1" view={next} busy={false} readOnly={false} run={run} />,
    ) }
  }

  it('opens Research and takes the page to the tech tree when a grant arrives, and not for one that was already there', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { again } = renderGrants(withGrants(1))
    expect(selected()).toBe('Trade (now)')
    expect(scroll).not.toHaveBeenCalled()

    again(withGrants(2))
    expect(selected()).toBe('Research')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    // The same grants on a refresh do not scroll again, and using one up does not either
    again(withGrants(2))
    again(withGrants(1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('does not take the page there when the viewer returns from a replayed revision', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const replay = viewIn('TRADE', [], { startOfTurn: null })
    const { again } = renderGrants(withGrants(1))
    again(replay)
    again(withGrants(1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(scroll).not.toHaveBeenCalled()
  })
})

describe('the Tech panel in Research', () => {
  it('sits inside the Research tab below the cards that can be played there', () => {
    const card = {
      itemId: 'c1',
      name: 'Counterfeiters',
      kind: 'culture',
      description: 'Research: draw a card.',
      timings: ['RESEARCH'],
      targets: { kind: 'none' },
      prompt: '',
      resources: [],
      discards: true,
      status: 'ready',
      reason: 'Can be played in Research.',
    }
    renderPanel(viewIn('RESEARCH', [], { playableCards: [card] }))

    const panel = document.getElementById('phase-panel-RESEARCH') as HTMLElement
    const cards = within(panel).getByRole('heading', { name: 'Cards you can play' })
    const techs = document.getElementById('techs') as HTMLElement
    expect(techs.closest('#phase-panel-RESEARCH')).toBe(panel)
    expect(cards.compareDocumentPosition(techs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The tech panel's own content, without a collapsible wrapper or its title.
    expect(within(techs).getByRole('button', { name: 'Level 1' })).toBeTruthy()
    expect(within(techs).queryByRole('button', { name: /^Techs/ })).toBeNull()
    expect(document.getElementById('techs-content')).toBeNull()
  })

  it('is not on the page while another tab is open', () => {
    renderPanel(viewIn('SOT'))
    expect(document.getElementById('techs')).toBeNull()
    fireEvent.click(tab(/^Research/))
    expect(document.getElementById('techs')).toBeTruthy()
    fireEvent.click(tab(/^Start of turn/))
    expect(document.getElementById('techs')).toBeNull()
  })

  it('opens Your actions and Research from a tech link when both are closed or on another phase', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    localStorage.setItem('civ.panel.actions', 'false')
    renderPanel(viewIn('SOT'))
    expect(document.getElementById('actions-content')?.hidden).toBe(true)
    goToPanel('techs')

    await waitFor(() => expect(document.getElementById('actions-content')?.hidden).toBe(false))
    expect(selected()).toBe('Research')
    expect(localStorage.getItem('civ.panel.actions')).toBe('true')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
  })

  it('waits for Your actions to open before scrolling when Research is already selected', async () => {
    const scroll = vi.fn(function (this: Element) {
      expect(document.getElementById('actions-content')?.hidden).toBe(false)
      return this
    })
    Element.prototype.scrollIntoView = scroll
    localStorage.setItem('civ.panel.actions', 'false')
    renderPanel(viewIn('RESEARCH'))
    expect(document.getElementById('phase-tab-RESEARCH')?.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById('actions-content')?.hidden).toBe(true)

    goToPanel('techs')

    expect(scroll).not.toHaveBeenCalled()
    await waitFor(() => expect(scroll).toHaveBeenCalledOnce())
  })
})

describe('buttons with their own text', () => {
  it('says what the button does when the action names it, without a second name beside it', () => {
    const cristo: Action = {
      action: 'sot:cristoRedentor:2',
      label: 'Cristo Redentor, level II events',
      buttonText: 'Cristo Redentor: draw two level II events',
      phase: 'SOT',
      group: 'Wonders',
      status: 'ready',
      reason: 'Draw two culture II cards. You keep both.',
      repeatable: false,
    }
    renderPanel(viewIn('SOT', [cristo]))
    expect(screen.getByRole('button', { name: 'Cristo Redentor: draw two level II events' })).toBeTruthy()
    expect(screen.queryByText('Cristo Redentor, level II events')).toBeNull()
  })
})

describe('currentPhaseOf and phaseStatusText', () => {
  it('reads the viewer from the waiting list by username', () => {
    const view = {
      you: { username: 'Alice' },
      activeTurn: {
        waitingFor: [
          { username: 'Bob', phase: 'SOT' },
          { username: 'Alice', phase: 'MOVEMENT' },
        ],
      },
    } as unknown as PlayerView
    expect(currentPhaseOf(view)).toBe('MOVEMENT')
  })

  it('is null for a spectator, without an active turn, and when the viewer is not waited for', () => {
    expect(currentPhaseOf({ you: null, activeTurn: { waitingFor: [] } } as unknown as PlayerView)).toBeNull()
    expect(currentPhaseOf({ you: { username: 'Alice' }, activeTurn: null } as unknown as PlayerView)).toBeNull()
    expect(
      currentPhaseOf({
        you: { username: 'Alice' },
        activeTurn: { waitingFor: [{ username: 'Bob', phase: 'SOT' }] },
      } as unknown as PlayerView),
    ).toBeNull()
  })

  it('words the three cases', () => {
    expect(phaseStatusText('CM', 'CM')).toBe('This is your current phase.')
    expect(phaseStatusText('SOT', 'CM')).toBe('You have finished this phase.')
    expect(phaseStatusText('RESEARCH', 'CM')).toMatch(/^Not yet: you are in city management/)
    expect(phaseStatusText('SOT', null)).toBe('You have finished every phase of this turn.')
  })
})
