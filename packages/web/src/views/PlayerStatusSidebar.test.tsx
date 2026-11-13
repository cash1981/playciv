// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PLAYER_STATS, EMPTY_COIN_SOURCES } from '@civ/engine'
import type { PlayerStats } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { AboutView } from './AboutView.js'
import { PlayerStatusSidebar, flagColor, formatCombat } from './PlayerStatusSidebar.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const aliceStats: PlayerStats = {
  ...DEFAULT_PLAYER_STATS,
  coinSources: { ...EMPTY_COIN_SOURCES, bank: 3, pottery: 2 },
  trade: 7,
  culture: 11,
  cultureHandSize: 4,
  infantry: 3,
  artillery: 2,
  mounted: 1,
  aircraft: false,
  stacking: 5,
  mvmt: '3+1',
  combat: 2,
  combatHandSize: '5+2',
  efta: 6,
  infra: 8,
  mic: 9,
  pe: 10,
}

function makeView(overrides: { readonly opponent?: Record<string, unknown>; readonly you?: null } = {}): PlayerView {
  return {
    active: true,
    activeTurn: null,
    board: { pieces: [] },
    you:
      overrides.you === null
        ? null
        : {
            playerId: 'player-me',
            username: 'Alice',
            color: 'Red',
            yourTurn: true,
            civilization: { name: 'Aztecs' },
            government: 'Despotism',
            stats: aliceStats,
            techsChosen: [{ name: 'Secret Tech', hidden: true }],
            socialPolicies: [],
          },
    opponents: [
      {
        playerId: 'player-them',
        username: 'Bob',
        color: 'Blue',
        yourTurn: false,
        civilization: null,
        government: 'Republic',
        stats: { ...DEFAULT_PLAYER_STATS, aircraft: true, combatHandSize: '' },
        revealedTechs: [],
        revealedSocialPolicies: [],
        ...overrides.opponent,
      },
    ],
  } as unknown as PlayerView
}

const block = (name: string): HTMLElement => screen.getByRole('region', { name: `${name} status` })

describe('PlayerStatusSidebar', () => {
  it('shows every status value of the Player status table with an accessible icon name', () => {
    render(<PlayerStatusSidebar view={makeView()} />)
    const alice = within(block('Alice'))

    const expected: readonly (readonly [string, string])[] = [
      ['Coins', '5'],
      ['Trade', '7'],
      ['Culture', '11'],
      ['Culture hand size', '4'],
      ['Infantry', '3'],
      ['Artillery', '2'],
      ['Mounted', '1'],
      ['Stacking', '5'],
      ['Movement', '3+1'],
      ['Combat', '+2'],
      ['Combat hand size', '5+2'],
      ['EftA', '6'],
      ['Infra', '8'],
      ['MIC', '9'],
      ['PE', '10'],
    ]
    for (const [label, value] of expected) {
      const icon = alice.getByRole('img', { name: label })
      expect(icon.closest('li')?.textContent).toContain(value)
      expect(icon.closest('li')?.getAttribute('title')).toBe(label)
    }
    expect(alice.getByRole('img', { name: 'Aircraft locked' })).toBeTruthy()
  })

  it('shows username, civilization, the civ marker and the government as text with the seal', () => {
    render(<PlayerStatusSidebar view={makeView()} />)
    const alice = within(block('Alice'))

    expect(alice.getByRole('heading', { name: 'Alice - Aztecs' })).toBeTruthy()
    expect(alice.getByRole('img', { name: 'Aztecs marker' }).getAttribute('src')).toBe(
      '/board/leaders/Aztec_red.png',
    )
    expect(alice.getByText('Despotism')).toBeTruthy()
    expect(alice.getByRole('img', { name: 'Government' }).getAttribute('src')).toBe(
      '/status-icons/government.svg',
    )
    expect(block('Alice').style.getPropertyValue('--player-color')).toBe('red')
  })

  it('falls back to a colour swatch without a marker when the civilization is hidden', () => {
    render(<PlayerStatusSidebar view={makeView()} />)
    const bob = within(block('Bob'))

    expect(bob.getByRole('heading', { name: 'Bob - hidden' })).toBeTruthy()
    expect(bob.queryByRole('img', { name: /marker/ })).toBeNull()
    expect(block('Bob').querySelector('.pss-swatch')).not.toBeNull()
    expect(bob.getByText('Republic')).toBeTruthy()
  })

  it('draws the combat bonus from the view inside the starburst, with a smaller font for three characters', () => {
    const { rerender } = render(<PlayerStatusSidebar view={makeView()} />)
    const value = (name: string): SVGTextElement =>
      block(name).querySelector<SVGTextElement>('[data-testid="combat-value"]')!
    expect(value('Alice').textContent).toBe('+2')
    expect(value('Bob').textContent).toBe('+0')

    const twoChars = Number(value('Alice').getAttribute('font-size'))
    rerender(
      <PlayerStatusSidebar view={makeView({ opponent: { stats: { ...DEFAULT_PLAYER_STATS, combat: 12 } } })} />,
    )
    expect(value('Bob').textContent).toBe('+12')
    expect(Number(value('Bob').getAttribute('font-size'))).toBeLessThan(twoChars)
    expect(formatCombat(-1)).toBe('-1')
  })

  it('draws the movement flag in the player colour', () => {
    render(<PlayerStatusSidebar view={makeView()} />)
    const flag = (name: string): string | null =>
      block(name).querySelector('[data-testid="movement-icon"] path[d^="M33 12"]')!.getAttribute('fill')

    expect(flag('Alice')).toBe('#d9392f')
    expect(flag('Bob')).toBe('#22b5ea')
    expect(flagColor('Purple')).toBe('#8a52b0')
    expect(flagColor('mauve')).toBe('#9aa3a7')
    expect(flagColor(null)).toBe('#9aa3a7')
  })

  it('renders an empty combat hand size gracefully', () => {
    render(<PlayerStatusSidebar view={makeView()} />)
    const bob = within(block('Bob'))

    const item = bob.getByRole('img', { name: 'Combat hand size' }).closest('li')!
    expect(item.textContent).toBe('–')
    expect(item.className).toContain('pss-empty')
  })

  it('shows aircraft locked (dimmed) when false and normal when true', () => {
    render(<PlayerStatusSidebar view={makeView()} />)

    const locked = within(block('Alice')).getByRole('img', { name: 'Aircraft locked' })
    expect(locked.className).toContain('pss-locked')
    const unlocked = within(block('Bob')).getByRole('img', { name: 'Aircraft unlocked' })
    expect(unlocked.className).not.toContain('pss-locked')
  })

  it('tags the player in focus with turn', () => {
    const view = {
      ...makeView(),
      activeTurn: {
        username: 'Bob',
        turnNumber: 1,
        waitingFor: [{ username: 'Bob', phase: 'trade' }],
      },
    } as unknown as PlayerView
    render(<PlayerStatusSidebar view={view} />)

    expect(within(block('Bob')).getByText('turn')).toBeTruthy()
    expect(within(block('Alice')).queryByText('turn')).toBeNull()
  })

  it('shows no turn tag once the game has ended, although activeTurn is still set', () => {
    const view = {
      ...makeView(),
      active: false,
      activeTurn: {
        username: 'Bob',
        turnNumber: 4,
        waitingFor: [{ username: 'Bob', phase: 'trade' }],
      },
    } as unknown as PlayerView
    render(<PlayerStatusSidebar view={view} />)

    expect(screen.queryByText('turn')).toBeNull()
  })

  it('wraps long free-text values instead of truncating them', () => {
    const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
    const rule = /\.pss-value \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toContain('white-space: normal')
    expect(rule).toContain('overflow-wrap: anywhere')
    expect(rule).not.toContain('text-overflow')
    expect(rule).not.toContain('nowrap')
  })

  it('scrolls a long name and civilization sideways instead of truncating the title', () => {
    const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
    const rule = /\.pss-title \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toContain('overflow-x: auto')
    expect(rule).not.toContain('text-overflow')
  })

  it('is read-only: no inputs, buttons or api calls', () => {
    const methods = api as unknown as Record<string, (...args: unknown[]) => unknown>
    const calls = Object.keys(methods)
      .filter((key) => typeof methods[key] === 'function')
      .map((key) => vi.spyOn(methods, key))
    expect(calls.length).toBeGreaterThan(50)
    const { container } = render(<PlayerStatusSidebar view={makeView()} />)

    expect(container.querySelectorAll('input, button, select, textarea, a')).toHaveLength(0)
    expect(calls.every((call) => call.mock.calls.length === 0)).toBe(true)
  })

  it('shows a spectator every player', () => {
    render(<PlayerStatusSidebar view={makeView({ you: null })} />)

    expect(screen.queryByRole('region', { name: 'Alice status' })).toBeNull()
    expect(block('Bob')).toBeTruthy()
  })

  it('leaks nothing hidden about an opponent or the viewer', () => {
    const view = makeView({
      opponent: {
        hand: [{ name: 'Secret Hand Card' }],
        handCount: 99,
        techsChosen: [{ name: 'Secret Opponent Tech', hidden: true }],
        privateLog: ['Secret log line'],
        notes: 'Secret private note',
        civilizationChoices: ['Secret Choice Civ'],
        civilization: { name: 'Romans' },
      },
    })
    const { container } = render(<PlayerStatusSidebar view={view} />)
    const text = container.textContent ?? ''
    const html = container.innerHTML

    for (const secret of ['Secret Hand Card', 'Secret Opponent Tech', 'Secret Tech', 'Secret log line', 'Secret private note', 'Secret Choice Civ', '99']) {
      expect(text).not.toContain(secret)
      expect(html).not.toContain(secret)
    }
    expect(within(block('Bob')).getByRole('heading', { name: 'Bob - Romans' })).toBeTruthy()
  })
})

describe('About page credits', () => {
  it('credits the stacking and combat hand size icons', () => {
    render(<AboutView />)

    expect(screen.getByText('Stacking icon: Layer icon by riajulislam, from Magnific (Freepik)')).toBeTruthy()
    expect(screen.getByText('Combat hand size icon: Swords icon from Magnific (Freepik)')).toBeTruthy()
  })
})
