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

  it('lists who is furthest behind and leaves the viewer and those ahead out of the waiting line', () => {
    const { container } = render(
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
    // carol is ahead of bob, so only bob holds the round up
    expect(screen.getByText('Waiting for bob (trade)')).toBeTruthy()
    expect(text(container)).not.toContain('carol')
  })

  it('names only the players at the earliest phase, together, with that phase', () => {
    render(
      <PhaseSummary
        view={viewOf({
          waitingFor: [
            { username: 'viewer', phase: 'MOVEMENT' },
            { username: 'bob', phase: 'CM' },
            { username: 'carol', phase: 'CM' },
            { username: 'dave', phase: 'RESEARCH' },
          ],
        })}
      />,
    )
    expect(screen.getByText('Waiting for bob, carol (city management)')).toBeTruthy()
  })

  it('says nothing about players who are ahead when the viewer is the one furthest behind', () => {
    const { container } = render(
      <PhaseSummary
        view={viewOf({
          waitingFor: [
            { username: 'viewer', phase: 'CM' },
            { username: 'bob', phase: 'MOVEMENT' },
          ],
        })}
      />,
    )
    expect(screen.getByText('You: City management (3 of 5)')).toBeTruthy()
    expect(text(container)).not.toContain('Waiting for')
  })

  it('lists the other player of a tie with the viewer', () => {
    render(
      <PhaseSummary
        view={viewOf({
          waitingFor: [
            { username: 'viewer', phase: 'CM' },
            { username: 'bob', phase: 'CM' },
          ],
        })}
      />,
    )
    expect(screen.getByText('Waiting for bob (city management)')).toBeTruthy()
  })

  it('names the earlier phase when the other player is still in city management, not movement', () => {
    // The viewer is done with Movement; bob is not.
    const { rerender } = render(
      <PhaseSummary view={viewOf({ waitingFor: [{ username: 'bob', phase: 'MOVEMENT' }] })} />,
    )
    expect(screen.getByText('Waiting for bob (movement)')).toBeTruthy()
    rerender(<PhaseSummary view={viewOf({ waitingFor: [{ username: 'bob', phase: 'CM' }] })} />)
    expect(screen.getByText('Waiting for bob (city management)')).toBeTruthy()
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
    expect(screen.getByText('Waiting for viewer (trade)')).toBeTruthy()
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

  const page = (actions = true): React.JSX.Element => (
    <>
      <PageShortcuts actions={actions} />
      <section id={BOARD_PANEL_ID} tabIndex={-1} aria-label="Board panel" />
      <CollapsiblePanel id="actions" title="Your actions" defaultOpen>
        <p>actions</p>
      </CollapsiblePanel>
      <CollapsiblePanel id="hand" title="Hand" defaultOpen>
        <p>cards</p>
      </CollapsiblePanel>
      <CollapsiblePanel id="techs" title="Tech panel" defaultOpen>
        <p>techs</p>
      </CollapsiblePanel>
    </>
  )

  const matchMedia = (matches: boolean): void => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }))
  }

  const labels = (): (string | null)[] =>
    Array.from(screen.getByRole('navigation', { name: 'Go to' }).querySelectorAll('button')).map(
      (button) => button.textContent,
    )

  it('offers Board, Actions, Your cards and Tech tree as buttons, and no Chat, History or Cities', () => {
    render(page())
    expect(labels()).toEqual(['Board', 'Actions', 'Your cards', 'Tech tree'])
  })

  it('leaves Actions out when Your actions is not on the page, so there is no dead button', () => {
    render(page(false))
    expect(labels()).toEqual(['Board', 'Your cards', 'Tech tree'])
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull()
  })

  it.each([
    ['Actions', 'Your actions'],
    ['Your cards', 'Hand'],
    ['Tech tree', 'Tech panel'],
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

  it.each([
    ['Your cards', 'Hand', 'hand'],
    ['Tech tree', 'Tech panel', 'techs'],
  ])('%s still lands on the heading of a collapsed panel, without opening it', (label, title, id) => {
    localStorage.setItem(`civ.panel.${id}`, 'false')
    render(page())
    const toggle = screen.getByRole('heading', { name: title }).querySelector('button')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(document.activeElement).toBe(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(localStorage.getItem(`civ.panel.${id}`)).toBe('false')
  })

  it('Actions opens Your actions when it is collapsed, remembers that, and lands on its heading', () => {
    localStorage.setItem('civ.panel.actions', 'false')
    render(page())
    const toggle = screen.getByRole('heading', { name: 'Your actions' }).querySelector('button')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(localStorage.getItem('civ.panel.actions')).toBe('true')
    expect(document.activeElement).toBe(toggle)
    expect(scrolled.map((entry) => entry.element)).toEqual([toggle?.closest('section')])
  })

  it('Actions leaves Your actions open when it is already open, however often it is pressed', () => {
    render(page())
    const toggle = screen.getByRole('heading', { name: 'Your actions' }).querySelector('button')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(localStorage.getItem('civ.panel.actions')).toBe('true')
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
    render(<PageShortcuts actions />)
    fireEvent.click(screen.getByRole('button', { name: 'Tech tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    expect(scrolled).toEqual([])
  })
})
