// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { useState } from 'react'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PLAYER_STATS, EMPTY_COIN_SOURCES, GOVERNMENT_CARDS, GOVERNMENTS, MAX_COMBAT_HAND_SIZE_LENGTH } from '@civ/engine'
import type { PlayerStats } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { AboutView } from './AboutView.js'
import type { Run } from './GameView.js'
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

const run: Run = async (action) => {
  await action()
}

/** What a viewer who cannot edit (spectator, replay, locked game) gets: the plain display. */
type ViewerProps = Omit<Parameters<typeof PlayerStatusSidebar>[0], 'view'>
const READ_ONLY: ViewerProps = { gameId: 'game-1', busy: false, readOnly: true, run }
const EDITABLE: ViewerProps = { gameId: 'game-1', busy: false, readOnly: false, run }

const block = (name: string): HTMLElement => screen.getByRole('region', { name: `${name} status` })

describe('PlayerStatusSidebar', () => {
  it.each([
    ['a viewer who cannot edit', READ_ONLY],
    ['an editor', EDITABLE],
  ])('shows every status value of the Player status table with an accessible icon name for %s', (_who, props) => {
    render(<PlayerStatusSidebar {...props} view={makeView()} />)
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
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)
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
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)
    const bob = within(block('Bob'))

    expect(bob.getByRole('heading', { name: 'Bob - hidden' })).toBeTruthy()
    expect(bob.queryByRole('img', { name: /marker/ })).toBeNull()
    expect(block('Bob').querySelector('.pss-swatch')).not.toBeNull()
    expect(bob.getByText('Republic')).toBeTruthy()
  })

  it('draws the combat bonus from the view inside the starburst, with a smaller font for three characters', () => {
    const { rerender } = render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)
    const value = (name: string): SVGTextElement =>
      block(name).querySelector<SVGTextElement>('[data-testid="combat-value"]')!
    expect(value('Alice').textContent).toBe('+2')
    expect(value('Bob').textContent).toBe('+0')

    const twoChars = Number(value('Alice').getAttribute('font-size'))
    rerender(
      <PlayerStatusSidebar {...READ_ONLY} view={makeView({ opponent: { stats: { ...DEFAULT_PLAYER_STATS, combat: 12 } } })} />,
    )
    expect(value('Bob').textContent).toBe('+12')
    expect(Number(value('Bob').getAttribute('font-size'))).toBeLessThan(twoChars)
    expect(formatCombat(-1)).toBe('-1')
  })

  it('draws the movement flag in the player colour', () => {
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)
    const flag = (name: string): string | null =>
      block(name).querySelector('[data-testid="movement-icon"] path[d^="M33 12"]')!.getAttribute('fill')

    expect(flag('Alice')).toBe('#d9392f')
    expect(flag('Bob')).toBe('#22b5ea')
    expect(flagColor('Purple')).toBe('#8a52b0')
    expect(flagColor('mauve')).toBe('#9aa3a7')
    expect(flagColor(null)).toBe('#9aa3a7')
  })

  it('renders an empty combat hand size gracefully', () => {
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)
    const bob = within(block('Bob'))

    const item = bob.getByRole('img', { name: 'Combat hand size' }).closest('li')!
    expect(item.textContent).toBe('–')
    expect(item.className).toContain('pss-empty')
  })

  it('shows aircraft locked (dimmed) when false and normal when true', () => {
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)

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
    render(<PlayerStatusSidebar {...READ_ONLY} view={view} />)

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
    render(<PlayerStatusSidebar {...READ_ONLY} view={view} />)

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

  it('takes the icon size and the width from the Display settings variables, with the old sizes as fallback', () => {
    const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
    expect(/\.pss-icon \{[^}]*\}/.exec(css)?.[0]).toContain('calc(1.9rem * var(--pss-scale, 1))')
    expect(/\.pss-value \{[^}]*\}/.exec(css)?.[0]).toContain('calc(0.85rem * var(--pss-scale, 1))')
    const layout = readFileSync('src/styles.css', 'utf8').replaceAll('\r\n', '\n')
    // Only the wide layout reads the width; the stacked one at 900px and below is `width: auto`.
    const wide = /\.board-main > \.player-status-sidebar \{[^}]*\}/.exec(layout)?.[0] ?? ''
    expect(wide).toContain('width: var(--pss-width, 16.5rem)')
    const stacked = /@media \(max-width: 900px\) \{[\s\S]*?\n\}\n/.exec(layout.slice(layout.indexOf('.board-main {')))?.[0] ?? ''
    expect(stacked).toContain('width: auto')
    expect(stacked).not.toContain('--pss-width')
  })

  it('is plain display when readOnly: no inputs, selects or api calls, and only the government reference button', () => {
    const methods = api as unknown as Record<string, (...args: unknown[]) => unknown>
    const calls = Object.keys(methods)
      .filter((key) => typeof methods[key] === 'function')
      .map((key) => vi.spyOn(methods, key))
    expect(calls.length).toBeGreaterThan(50)
    const { container } = render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)

    expect(container.querySelectorAll('input, select, textarea, a')).toHaveLength(0)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Show government card reference',
      'Show government card reference',
    ])
    expect(calls.every((call) => call.mock.calls.length === 0)).toBe(true)
  })

  it('shows a spectator every player', () => {
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView({ you: null })} />)

    expect(screen.queryByRole('region', { name: 'Alice status' })).toBeNull()
    expect(block('Bob')).toBeTruthy()
  })

  it.each([
    ['a viewer who cannot edit', READ_ONLY],
    ['an editor', EDITABLE],
  ])('leaks nothing hidden about an opponent or the viewer to %s', (_who, props) => {
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
    const { container } = render(<PlayerStatusSidebar {...props} view={view} />)
    const text = container.textContent ?? ''
    const html = container.innerHTML

    for (const secret of ['Secret Hand Card', 'Secret Opponent Tech', 'Secret Tech', 'Secret log line', 'Secret private note', 'Secret Choice Civ', '99']) {
      expect(text).not.toContain(secret)
      expect(html).not.toContain(secret)
    }
    expect(within(block('Bob')).getByRole('heading', { name: 'Bob - Romans' })).toBeTruthy()
  })
})

describe('PlayerStatusSidebar editing', () => {
  const view = makeView()
  const stat = (name: string): HTMLElement => screen.getByRole('button', { name })
  const field = (name: string): HTMLInputElement => screen.getByRole('textbox', { name }) as HTMLInputElement
  const setStat = () => vi.spyOn(api, 'setPlayerStat').mockResolvedValue(view)
  const open = (name: string): void => {
    fireEvent.click(stat(name))
  }
  const renderEditable = (v: PlayerView = view, props: Partial<ViewerProps> = {}): void => {
    render(<PlayerStatusSidebar {...EDITABLE} {...props} view={v} />)
  }

  it('names each stat with its player, stat and current value', () => {
    renderEditable()

    expect(stat('Edit Alice Trade, currently 7')).toBeTruthy()
    expect(stat('Edit Alice Movement, currently 3+1')).toBeTruthy()
    expect(stat('Edit Alice Combat hand size, currently 5+2')).toBeTruthy()
    expect(stat('Edit Bob Combat hand size, currently empty')).toBeTruthy()
    expect(stat('Edit Bob PE, currently 0')).toBeTruthy()
  })

  it('saves an edited number on Enter through the shared runner and returns focus to the stat', async () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Trade, currently 7')
    const input = field('Alice Trade')
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'trade', 9))
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group', { name: 'Edit Alice Trade' })).toBeNull()
    expect(document.activeElement).toBe(stat('Edit Alice Trade, currently 7'))
  })

  it('saves when focus leaves the editor and when Done is pressed, once each', async () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Culture, currently 11')
    fireEvent.change(field('Alice Culture'), { target: { value: '12' } })
    fireEvent.blur(field('Alice Culture'))
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'culture', 12))
    expect(screen.queryByRole('group', { name: 'Edit Alice Culture' })).toBeNull()

    open('Edit Alice Infra, currently 8')
    fireEvent.change(field('Alice Infra'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done editing Alice Infra' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'infra', 4))
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('does not save an unchanged value', () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Trade, currently 7')
    fireEvent.keyDown(field('Alice Trade'), { key: 'Enter' })

    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Edit Alice Trade' })).toBeNull()
  })

  it('steps a number with + and - and saves it on Done, never below zero', async () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Mounted, currently 1')
    fireEvent.click(screen.getByRole('button', { name: 'Increase Alice Mounted' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase Alice Mounted' }))
    expect(field('Alice Mounted').value).toBe('3')
    fireEvent.click(screen.getByRole('button', { name: 'Done editing Alice Mounted' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'mounted', 3))
    expect(save).toHaveBeenCalledTimes(1)

    open('Edit Bob PE, currently 0')
    expect((screen.getByRole('button', { name: 'Decrease Bob PE' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a stepper button does not take focus from the field, so it cannot save early', () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Mounted, currently 1')
    const mouseDown = fireEvent.mouseDown(screen.getByRole('button', { name: 'Increase Alice Mounted' }))

    expect(mouseDown).toBe(false) // preventDefault was called
    expect(save).not.toHaveBeenCalled()
  })

  it('drops an invalid number without calling the api, like the old cell', () => {
    const save = setStat()
    renderEditable()

    for (const bad of ['abc', '', '-', '-3', '1.5']) {
      open('Edit Alice Trade, currently 7')
      fireEvent.change(field('Alice Trade'), { target: { value: bad } })
      fireEvent.keyDown(field('Alice Trade'), { key: 'Enter' })
      expect(screen.queryByRole('group', { name: 'Edit Alice Trade' })).toBeNull()
    }

    expect(save).not.toHaveBeenCalled()
    expect(stat('Edit Alice Trade, currently 7')).toBeTruthy()
  })

  it('caps Trade at 27, and at 25 for the Japanese', async () => {
    const save = setStat()
    const japanese = makeView({ opponent: { civilization: { name: 'Japanese' }, stats: { ...DEFAULT_PLAYER_STATS, trade: 24 } } })
    renderEditable(japanese)

    open('Edit Alice Trade, currently 7')
    expect(screen.getByText('max 27')).toBeTruthy()
    fireEvent.change(field('Alice Trade'), { target: { value: '28' } })
    fireEvent.keyDown(field('Alice Trade'), { key: 'Enter' })
    expect(save).not.toHaveBeenCalled()
    open('Edit Alice Trade, currently 7')
    fireEvent.change(field('Alice Trade'), { target: { value: '27' } })
    fireEvent.keyDown(field('Alice Trade'), { key: 'Enter' })
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'trade', 27))

    open('Edit Bob Trade, currently 24')
    expect(screen.getByText('max 25')).toBeTruthy()
    fireEvent.change(field('Bob Trade'), { target: { value: '26' } })
    fireEvent.keyDown(field('Bob Trade'), { key: 'Enter' })
    expect(save).toHaveBeenCalledTimes(1)
    open('Edit Bob Trade, currently 24')
    fireEvent.click(screen.getByRole('button', { name: 'Increase Bob Trade' }))
    expect(field('Bob Trade').value).toBe('25')
    expect((screen.getByRole('button', { name: 'Increase Bob Trade' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Done editing Bob Trade' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-them', 'trade', 25))
  })

  it('edits any player, not only the viewer', async () => {
    const save = setStat()
    renderEditable()

    open('Edit Bob EftA, currently 0')
    fireEvent.change(field('Bob EftA'), { target: { value: '2' } })
    fireEvent.keyDown(field('Bob EftA'), { key: 'Enter' })

    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-them', 'efta', 2))
  })

  it('edits Movement as an expression and refuses a typo', async () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Movement, currently 3+1')
    expect(screen.queryByRole('button', { name: 'Increase Alice Movement' })).toBeNull()
    fireEvent.change(field('Alice Movement'), { target: { value: '3+' } })
    fireEvent.keyDown(field('Alice Movement'), { key: 'Enter' })
    expect(save).not.toHaveBeenCalled()

    open('Edit Alice Movement, currently 3+1')
    fireEvent.change(field('Alice Movement'), { target: { value: '2+1+1' } })
    fireEvent.keyDown(field('Alice Movement'), { key: 'Enter' })
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'mvmt', '2+1+1'))
  })

  it('edits Combat hand size as free text with the length limit, and can clear it', async () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Combat hand size, currently 5+2')
    expect(field('Alice Combat hand size').maxLength).toBe(MAX_COMBAT_HAND_SIZE_LENGTH)
    fireEvent.change(field('Alice Combat hand size'), { target: { value: '+1' } })
    fireEvent.keyDown(field('Alice Combat hand size'), { key: 'Enter' })
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'combatHandSize', '+1'))

    open('Edit Alice Combat hand size, currently 5+2')
    fireEvent.change(field('Alice Combat hand size'), { target: { value: '' } })
    fireEvent.keyDown(field('Alice Combat hand size'), { key: 'Enter' })
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'combatHandSize', ''))

    open('Edit Alice Combat hand size, currently 5+2')
    fireEvent.change(field('Alice Combat hand size'), {
      target: { value: 'x'.repeat(MAX_COMBAT_HAND_SIZE_LENGTH + 1) },
    })
    fireEvent.keyDown(field('Alice Combat hand size'), { key: 'Enter' })
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('Escape cancels without saving and returns focus to the stat', () => {
    const save = setStat()
    renderEditable()

    open('Edit Alice Trade, currently 7')
    fireEvent.change(field('Alice Trade'), { target: { value: '9' } })
    fireEvent.keyDown(field('Alice Trade'), { key: 'Escape' })

    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Edit Alice Trade' })).toBeNull()
    expect(document.activeElement).toBe(stat('Edit Alice Trade, currently 7'))
  })

  it('opens the editor under its grid row and keeps the four-column grid intact', () => {
    renderEditable()

    open('Edit Alice Culture, currently 11')
    const grid = within(block('Alice')).getByRole('list', { name: 'Economy' })
    const children = [...grid.children]
    expect(children).toHaveLength(5)
    expect(children.slice(0, 4).every((item) => item.classList.contains('pss-stat'))).toBe(true)
    expect(children[4]?.classList.contains('pss-editor')).toBe(true)
    expect(stat('Edit Alice Culture, currently 11').getAttribute('aria-expanded')).toBe('true')
    expect(within(block('Alice')).getByRole('list', { name: 'Units' }).querySelector('.pss-editor')).toBeNull()
  })

  it('toggles Aircraft directly with a switch, in both directions', async () => {
    const save = setStat()
    renderEditable()

    const alice = screen.getByRole('switch', { name: 'Alice Aircraft unlocked' })
    expect(alice.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(alice)
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'aircraft', true))

    const bob = screen.getByRole('switch', { name: 'Bob Aircraft unlocked' })
    expect(bob.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(bob)
    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-them', 'aircraft', false))
  })

  it('leaves the calculated stats and the Coins total read-only', () => {
    renderEditable()

    for (const label of ['Coins', 'Culture hand size', 'Combat']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^Edit Alice ${label},`) })).toBeNull()
      expect(screen.queryByRole('textbox', { name: `Alice ${label}` })).toBeNull()
    }
    // Every other stat of the grids is editable: 12 buttons and the Aircraft switch.
    expect(within(block('Alice')).getAllByRole('button', { name: /^Edit Alice / })).toHaveLength(12)
    expect(within(block('Alice')).getAllByRole('switch')).toHaveLength(1)
  })

  it('saves a selected government for any player through the shared runner', async () => {
    const save = vi.spyOn(api, 'setPlayerGovernment').mockResolvedValue(view)
    renderEditable()

    const alice = screen.getByRole('combobox', { name: 'Alice government' }) as HTMLSelectElement
    expect(alice.value).toBe('Despotism')
    expect(alice.querySelectorAll('option')).toHaveLength(GOVERNMENTS.length)
    fireEvent.change(screen.getByRole('combobox', { name: 'Bob government' }), { target: { value: 'Monarchy' } })

    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-them', 'Monarchy'))
  })

  it('opens the government card reference from the ? button for an editor and returns focus on close', () => {
    renderEditable()

    const help = screen.getAllByRole('button', { name: 'Show government card reference' })[0]!
    help.focus()
    fireEvent.click(help)

    const dialog = screen.getByRole('dialog', { name: 'Government card reference' })
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(
      GOVERNMENT_CARDS.map((card) => card.government),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(help)
  })

  it('opens the same reference for a viewer who cannot edit', () => {
    render(<PlayerStatusSidebar {...READ_ONLY} view={view} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Show government card reference' })[1]!)

    expect(screen.getByRole('dialog', { name: 'Government card reference' })).toBeTruthy()
    expect(document.querySelectorAll('.reference-card')).toHaveLength(GOVERNMENT_CARDS.length)
  })

  it('offers nothing to edit when readOnly: no stat buttons, switches, selects or api calls', () => {
    const stats = setStat()
    const government = vi.spyOn(api, 'setPlayerGovernment').mockResolvedValue(view)
    render(<PlayerStatusSidebar {...READ_ONLY} view={view} />)

    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(stats).not.toHaveBeenCalled()
    expect(government).not.toHaveBeenCalled()
  })

  it('disables every control while busy and sends nothing', () => {
    const stats = setStat()
    const government = vi.spyOn(api, 'setPlayerGovernment').mockResolvedValue(view)
    renderEditable(view, { busy: true })

    // The stat buttons use aria-disabled, not disabled, so a save does not drop their focus.
    const buttons = [...screen.getAllByRole('button', { name: /^Edit / }), ...screen.getAllByRole('switch')]
    const selects = screen.getAllByRole('combobox')
    expect(buttons).toHaveLength(2 * 12 + 2)
    expect(selects).toHaveLength(2)
    expect(buttons.every((control) => control.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(selects.every((control) => (control as HTMLSelectElement).disabled)).toBe(true)
    fireEvent.click(stat('Edit Alice Trade, currently 7'))
    fireEvent.click(screen.getByRole('switch', { name: 'Alice Aircraft unlocked' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(stats).not.toHaveBeenCalled()
    expect(government).not.toHaveBeenCalled()
  })

  it('closes an open editor, without saving, when the sidebar becomes busy or read-only', () => {
    const save = setStat()
    const { rerender } = render(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    open('Edit Alice Trade, currently 7')
    fireEvent.change(field('Alice Trade'), { target: { value: '9' } })
    rerender(<PlayerStatusSidebar {...EDITABLE} busy view={view} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    rerender(<PlayerStatusSidebar {...EDITABLE} view={view} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('makes each stat a tap target of at least 44px and keeps the editor inside the grid cell width', () => {
    const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
    const rule = (selector: string): string =>
      new RegExp(`${selector.replaceAll('.', '\\.')} \\{[^}]*\\}`).exec(css)?.[0] ?? ''

    expect(rule('.pss-stat-button')).toContain('min-height: 44px')
    expect(rule('.pss-step,\n.pss-done')).toContain('min-height: 44px')
    expect(rule('.pss-editor')).toContain('grid-column: 1 / -1')
    expect(rule('.pss-editor-box')).toContain('flex-wrap: wrap')
    expect(rule('.pss-editor-input')).toContain('min-width: 0')
  })
})

describe('PlayerStatusSidebar editing while the game is busy', () => {
  const view = makeView()
  const stat = (name: string): HTMLElement => screen.getByRole('button', { name })
  const field = (name: string): HTMLInputElement => screen.getByRole('textbox', { name }) as HTMLInputElement
  const setStat = () => vi.spyOn(api, 'setPlayerStat').mockResolvedValue(view)
  const withAliceTrade = (trade: number): PlayerView =>
    ({ ...view, you: { ...view.you, stats: { ...aliceStats, trade } } }) as unknown as PlayerView

  /** GameView's `run`: busy goes up synchronously, and down when the action is done. */
  function Busy({ v = view }: { readonly v?: PlayerView }): React.JSX.Element {
    const [busy, setBusy] = useState(false)
    const busyRun: Run = async (action) => {
      setBusy(true)
      try {
        await action()
      } finally {
        setBusy(false)
      }
    }
    return <PlayerStatusSidebar gameId="game-1" view={v} busy={busy} readOnly={false} run={busyRun} />
  }

  it.each([
    ['Enter', (input: HTMLElement) => fireEvent.keyDown(input, { key: 'Enter' })],
    ['Done', () => fireEvent.click(screen.getByRole('button', { name: 'Done editing Alice Trade' }))],
    ['leaving the editor', (input: HTMLElement) => fireEvent.blur(input)],
  ])('never saves an untouched field after someone else changed the value (%s)', (_how, finish) => {
    const save = setStat()
    const { rerender } = render(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    fireEvent.click(stat('Edit Alice Trade, currently 7'))
    rerender(<PlayerStatusSidebar {...EDITABLE} view={withAliceTrade(9)} />)
    // The field follows the saved value while the user has not typed.
    expect(field('Alice Trade').value).toBe('9')
    finish(field('Alice Trade'))

    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Edit Alice Trade' })).toBeNull()
  })

  it('still saves what was typed after the value changed under the editor, and keeps the typing', async () => {
    const save = setStat()
    const { rerender } = render(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    fireEvent.click(stat('Edit Alice Trade, currently 7'))
    fireEvent.change(field('Alice Trade'), { target: { value: '8' } })
    rerender(<PlayerStatusSidebar {...EDITABLE} view={withAliceTrade(9)} />)
    expect(field('Alice Trade').value).toBe('8')
    fireEvent.keyDown(field('Alice Trade'), { key: 'Enter' })

    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'trade', 8))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves a stepped value after the value changed under the editor', async () => {
    const save = setStat()
    const { rerender } = render(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    fireEvent.click(stat('Edit Alice Trade, currently 7'))
    rerender(<PlayerStatusSidebar {...EDITABLE} view={withAliceTrade(9)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase Alice Trade' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done editing Alice Trade' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'trade', 10))
  })

  it('tapping a second stat right after changing the first saves the first and then opens the second', async () => {
    const save = setStat()
    render(<Busy />)

    fireEvent.click(stat('Edit Alice Trade, currently 7'))
    fireEvent.change(field('Alice Trade'), { target: { value: '9' } })
    const next = stat('Edit Alice Culture, currently 11')
    fireEvent.mouseDown(next)
    fireEvent.blur(field('Alice Trade'), { relatedTarget: next })
    fireEvent.click(next)

    await waitFor(() => expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'trade', 9))
    expect(await screen.findByRole('textbox', { name: 'Alice Culture' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Alice Trade' })).toBeNull()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a tap during a busy spell that no editor started does not open an editor later', () => {
    const { rerender } = render(<PlayerStatusSidebar {...EDITABLE} view={view} busy />)

    fireEvent.click(stat('Edit Alice Culture, currently 11'))
    rerender(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('forgets a tap kept during a save when the viewer becomes read-only, and gives no editor or focus back', () => {
    const save = setStat()
    const { rerender } = render(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    fireEvent.click(stat('Edit Alice Trade, currently 7'))
    fireEvent.change(field('Alice Trade'), { target: { value: '9' } })
    fireEvent.keyDown(field('Alice Trade'), { key: 'Enter' })
    expect(save).toHaveBeenCalledTimes(1)
    rerender(<PlayerStatusSidebar {...EDITABLE} view={view} busy />)
    fireEvent.click(stat('Edit Alice Culture, currently 11'))
    // Opening a replay revision: read-only and busy at once, then editable again later.
    rerender(<PlayerStatusSidebar {...EDITABLE} view={view} busy readOnly />)
    rerender(<PlayerStatusSidebar {...EDITABLE} view={view} readOnly />)
    rerender(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement?.tagName).not.toBe('INPUT')
  })

  it('keeps focus on the stat after a save completes', async () => {
    const save = setStat()
    render(<Busy />)

    fireEvent.click(stat('Edit Alice Trade, currently 7'))
    fireEvent.change(field('Alice Trade'), { target: { value: '9' } })
    fireEvent.keyDown(field('Alice Trade'), { key: 'Enter' })

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(stat('Edit Alice Trade, currently 7').getAttribute('aria-disabled')).toBe('false'))
    expect(document.activeElement).toBe(stat('Edit Alice Trade, currently 7'))
  })

  it('moves focus to the field when a stepper reaches the end of its range, so Escape still works', () => {
    setStat()
    render(<PlayerStatusSidebar {...EDITABLE} view={withAliceTrade(26)} />)

    fireEvent.click(stat('Edit Alice Trade, currently 26'))
    const input = field('Alice Trade')
    const increase = screen.getByRole('button', { name: 'Increase Alice Trade' })
    increase.focus()
    fireEvent.click(increase)
    expect(input.value).toBe('27')
    expect(document.activeElement).toBe(input)

    fireEvent.click(stat('Edit Alice Mounted, currently 1'))
    const decrease = screen.getByRole('button', { name: 'Decrease Alice Mounted' })
    decrease.focus()
    fireEvent.click(decrease)
    expect(field('Alice Mounted').value).toBe('0')
    expect(document.activeElement).toBe(field('Alice Mounted'))
  })

  it('pressing the expanded stat again closes its editor instead of reopening it', () => {
    const save = setStat()
    render(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    const trade = stat('Edit Alice Trade, currently 7')
    fireEvent.click(trade)
    // A mouse press blurs the field (closing the editor) before the click arrives,
    // so the click must not read the already-closed editor as a request to open it.
    fireEvent.mouseDown(trade)
    fireEvent.blur(field('Alice Trade'), { relatedTarget: trade })
    fireEvent.click(trade)
    expect(screen.queryByRole('group', { name: 'Edit Alice Trade' })).toBeNull()

    // A click with no press or blur before it (assistive technology activating the
    // button): the editor is open at that moment, and the click closes it.
    fireEvent.click(trade)
    expect(screen.getByRole('group', { name: 'Edit Alice Trade' })).toBeTruthy()
    fireEvent.click(trade)
    expect(screen.queryByRole('group', { name: 'Edit Alice Trade' })).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('a press that is dragged off the stat cannot swallow the next activation', () => {
    render(<PlayerStatusSidebar {...EDITABLE} view={view} />)

    const trade = stat('Edit Alice Trade, currently 7')
    fireEvent.click(trade)
    fireEvent.mouseDown(trade)
    fireEvent.blur(field('Alice Trade'), { relatedTarget: trade })
    fireEvent.mouseLeave(trade)
    // No click for that press; a later keyboard activation opens the editor.
    fireEvent.click(trade)

    expect(screen.getByRole('group', { name: 'Edit Alice Trade' })).toBeTruthy()
  })

  it('shows a busy stat dimmed and without the hover highlight of an enabled one', () => {
    const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
    const rule = (selector: string): string =>
      new RegExp(`${selector.replaceAll('[', '\\[').replaceAll(']', '\\]')} \\{[^}]*\\}`).exec(css)?.[0] ?? ''

    // The global `button:disabled` look does not reach an aria-disabled button.
    expect(rule(".pss-stat-button[aria-disabled='true']")).toContain('opacity: 0.45')
    const hover = rule(".pss-stat-button[aria-disabled='true']:hover")
    expect(hover).toContain('border-color: transparent')
    expect(hover).toContain('background: transparent')
  })
})

describe('About page credits', () => {
  it('credits the stacking and combat hand size icons', () => {
    render(<AboutView />)

    expect(screen.getByText('Stacking icon: Layer icon by riajulislam, from Magnific (Freepik)')).toBeTruthy()
    expect(screen.getByText('Combat hand size icon: Swords icon from Magnific (Freepik)')).toBeTruthy()
  })
})
