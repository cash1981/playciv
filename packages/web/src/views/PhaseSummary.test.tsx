// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_COIN_SOURCES, TURN_PHASES } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import type { PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { BOARD_PANEL_ID, PageShortcuts, PhaseSummary } from './PhaseSummary.js'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

interface Options {
  readonly waitingFor: readonly { readonly username: string; readonly phase: TurnPhase }[]
  readonly spectator?: boolean
  readonly pendingRewards?: readonly unknown[]
  readonly turnNumber?: number
  readonly noActiveTurn?: boolean
}

const viewOf = ({
  waitingFor,
  spectator = false,
  pendingRewards = [],
  turnNumber = 4,
  noActiveTurn = false,
}: Options): PlayerView =>
  ({
    activeTurn: noActiveTurn
      ? null
      : { playerId: 'id-viewer', username: 'viewer', turnNumber, phase: 'SOT', waitingFor, startPlayer: 'viewer' },
    you: spectator
      ? null
      : {
          playerId: 'id-viewer',
          username: 'viewer',
          pendingRewards,
          stats: { culture: 12, trade: 5, coinSources: { ...EMPTY_COIN_SOURCES, bank: 3, education: 4 } },
        },
    opponents: [{ playerId: 'id-bob', username: 'bob' }],
  }) as unknown as PlayerView

const text = (container: HTMLElement): string => container.textContent ?? ''

describe('PhaseSummary: the round and the viewer\'s phase', () => {
  const expected: Readonly<Record<TurnPhase, string>> = {
    SOT: 'You: Start of turn (1 of 5)',
    TRADE: 'You: Trade (2 of 5)',
    CM: 'You: City management (3 of 5)',
    MOVEMENT: 'You: Movement (4 of 5)',
    RESEARCH: 'You: Research (5 of 5)',
  }

  it.each(TURN_PHASES)('says the viewer is on %s, as the first phase not done', (phase) => {
    render(<PhaseSummary view={viewOf({ waitingFor: [{ username: 'viewer', phase }] })} />)
    expect(screen.getByText('Round 4')).toBeTruthy()
    expect(screen.getByText(expected[phase])).toBeTruthy()
  })

  it('says all phases are done once the viewer is no longer waited for, and names who is', () => {
    render(<PhaseSummary view={viewOf({ waitingFor: [{ username: 'bob', phase: 'MOVEMENT' }] })} />)
    expect(screen.getByText('You: all phases done')).toBeTruthy()
    expect(screen.getByText('Waiting for bob (movement)')).toBeTruthy()
  })

  it('defensively says everyone is done for an empty waiting list on an active turn', () => {
    render(<PhaseSummary view={viewOf({ waitingFor: [] })} />)
    expect(screen.getByText('You: all phases done')).toBeTruthy()
    expect(screen.getByText('Everyone is done')).toBeTruthy()
  })

  it('lists the others with their phase and leaves the viewer out of the waiting line', () => {
    render(
      <PhaseSummary
        view={viewOf({
          waitingFor: [
            { username: 'viewer', phase: 'CM' },
            { username: 'bob', phase: 'TRADE' },
            { username: 'carol', phase: 'MOVEMENT' },
          ],
        })}
      />,
    )
    expect(screen.getByText('You: City management (3 of 5)')).toBeTruthy()
    expect(screen.getByText('Waiting for bob (trade), carol (movement)')).toBeTruthy()
  })

  it('has no waiting line when only the viewer is left', () => {
    const { container } = render(<PhaseSummary view={viewOf({ waitingFor: [{ username: 'viewer', phase: 'SOT' }] })} />)
    expect(text(container)).not.toContain('Waiting for')
    expect(text(container)).not.toContain('Everyone is done')
  })

  it('shows no round or phase before the game has a turn, but still the resources', () => {
    const { container } = render(<PhaseSummary view={viewOf({ waitingFor: [], noActiveTurn: true })} />)
    expect(text(container)).not.toContain('Round')
    expect(text(container)).not.toContain('You:')
    expect(screen.getByRole('list', { name: 'Your resources' })).toBeTruthy()
  })
})

describe('PhaseSummary: resources', () => {
  it('shows culture, trade and the coin total of the viewer', () => {
    render(<PhaseSummary view={viewOf({ waitingFor: [{ username: 'viewer', phase: 'SOT' }] })} />)
    const items = Array.from(screen.getByRole('list', { name: 'Your resources' }).querySelectorAll('li')).map(
      (item) => item.textContent,
    )
    // Coins add up the sources: bank 3 and education 4
    expect(items).toEqual(['Culture 12', 'Trade 5', 'Coins 7'])
  })
})

describe('PhaseSummary: a spectator', () => {
  it('sees the round and who is waited for, and nothing about a player or resources', () => {
    const { container } = render(
      <PhaseSummary
        view={viewOf({
          spectator: true,
          waitingFor: [
            { username: 'viewer', phase: 'TRADE' },
            { username: 'bob', phase: 'CM' },
          ],
        })}
      />,
    )
    expect(screen.getByText('Round 4')).toBeTruthy()
    expect(screen.getByText('Waiting for viewer (trade), bob (city management)')).toBeTruthy()
    expect(text(container)).not.toContain('You:')
    expect(screen.queryByRole('list', { name: 'Your resources' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PhaseSummary: a card choice waiting', () => {
  const scrolled: Element[] = []

  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
  })

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('shows nothing without a choice', () => {
    render(<PhaseSummary view={viewOf({ waitingFor: [], pendingRewards: [] })} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('names one choice, and links to the Your actions panel', () => {
    render(
      <>
        <PhaseSummary view={viewOf({ waitingFor: [], pendingRewards: [{ id: 'r1' }] })} />
        <CollapsiblePanel id="actions" title="Your actions (1 choice waiting)" defaultOpen>
          <p>body</p>
        </CollapsiblePanel>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '1 card choice waiting' }))
    const heading = screen.getByRole('heading', { name: 'Your actions (1 choice waiting)' })
    expect(scrolled).toEqual([heading.closest('section')])
    expect(document.activeElement).toBe(heading.querySelector('button'))
  })

  it('falls back to the combined conversation panel after actions are embedded there', () => {
    render(
      <>
        <PhaseSummary view={viewOf({ waitingFor: [], pendingRewards: [{ id: 'r1' }] })} />
        <CollapsiblePanel id="chat-orders" title="Conversation & actions" defaultOpen>
          <p>body</p>
        </CollapsiblePanel>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '1 card choice waiting' }))
    const heading = screen.getByRole('heading', { name: 'Conversation & actions' })
    expect(scrolled).toEqual([heading.closest('section')])
    expect(document.activeElement).toBe(heading.querySelector('button'))
  })

  it('counts several choices', () => {
    render(<PhaseSummary view={viewOf({ waitingFor: [], pendingRewards: [{ id: 'r1' }, { id: 'r2' }] })} />)
    expect(screen.getByRole('button', { name: '2 card choices waiting' })).toBeTruthy()
  })

  it('shows none for a viewer whose projection has no pendingRewards field', () => {
    const view = viewOf({ waitingFor: [] })
    const { pendingRewards: _dropped, ...you } = view.you as unknown as Record<string, unknown>
    render(<PhaseSummary view={{ ...view, you } as unknown as PlayerView} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PageShortcuts', () => {
  const scrolled: { readonly element: Element; readonly options: unknown }[] = []

  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      scrolled.push({ element: this, options })
    }
  })

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  const page = (chat = true): React.JSX.Element => (
    <>
      <PageShortcuts chat={chat} />
      <section id={BOARD_PANEL_ID} tabIndex={-1} aria-label="Board panel" />
      <CollapsiblePanel id="hand" title="Hand" defaultOpen>
        <p>cards</p>
      </CollapsiblePanel>
      <CollapsiblePanel id="techs" title="Tech panel" defaultOpen>
        <p>techs</p>
      </CollapsiblePanel>
      <CollapsiblePanel id="chat-orders" title="Chat panel" defaultOpen>
        <p>chat</p>
      </CollapsiblePanel>
      <CollapsiblePanel id="log" title="Log panel" defaultOpen={false}>
        <p>log</p>
      </CollapsiblePanel>
    </>
  )

  const matchMedia = (matches: boolean): void => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }))
  }

  it('offers Board, Your cards, Tech tree, Chat and History as buttons', () => {
    render(page())
    const nav = screen.getByRole('navigation', { name: 'Go to' })
    expect(Array.from(nav.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Board',
      'Your cards',
      'Tech tree',
      'Chat',
      'History',
    ])
  })

  it('leaves Chat out when there is no chat panel', () => {
    render(page(false))
    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'History' })).toBeTruthy()
  })

  it.each([
    ['Your cards', 'Hand'],
    ['Tech tree', 'Tech panel'],
    ['Chat', 'Chat panel'],
    ['History', 'Log panel'],
  ])('%s scrolls its panel into view and focuses the panel heading button', (label, title) => {
    render(page())
    fireEvent.click(screen.getByRole('button', { name: label }))
    const heading = screen.getByRole('heading', { name: title })
    expect(scrolled.map((entry) => entry.element)).toEqual([heading.closest('section')])
    expect(document.activeElement).toBe(heading.querySelector('button'))
  })

  it('Board scrolls the board into view and focuses it', () => {
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    const board = document.getElementById(BOARD_PANEL_ID)
    expect(scrolled.map((entry) => entry.element)).toEqual([board])
    expect(document.activeElement).toBe(board)
  })

  it('still lands on the heading of a collapsed panel, without opening it', () => {
    render(page())
    const toggle = screen.getByRole('heading', { name: 'Log panel' }).querySelector('button')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(document.activeElement).toBe(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(localStorage.getItem('civ.panel.log')).toBe('false')
  })

  it('scrolls smoothly by default', () => {
    matchMedia(false)
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Your cards' }))
    expect(scrolled[0]?.options).toEqual({ behavior: 'smooth', block: 'start' })
  })

  it('scrolls smoothly when the browser cannot say what the user prefers', () => {
    // jsdom has no matchMedia
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Your cards' }))
    expect(scrolled[0]?.options).toEqual({ behavior: 'smooth', block: 'start' })
  })

  it('jumps without animation when the user prefers reduced motion', () => {
    const query = vi.fn((text: string) => ({ matches: true, media: text }))
    vi.stubGlobal('matchMedia', query)
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Your cards' }))
    expect(query).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(scrolled[0]?.options).toEqual({ behavior: 'auto', block: 'start' })
    // Focus still moves
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Hand' }).querySelector('button'))
  })

  it('does nothing, and does not throw, when the target is not on the page', () => {
    render(<PageShortcuts chat />)
    fireEvent.click(screen.getByRole('button', { name: 'Tech tree' }))
    expect(scrolled).toEqual([])
  })
})
