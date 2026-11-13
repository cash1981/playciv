// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { useState } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PLAYER_STATS, EMPTY_COIN_SOURCES, GOVERNMENT_CARDS, GOVERNMENTS, MAX_COMBAT_HAND_SIZE_LENGTH } from '@civ/engine'
import type { PlayerStats } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { AboutView } from './AboutView.js'
import type { Run } from './GameView.js'
import { openGovernmentReference } from './GovernmentReferenceDialog.js'
import { PlayerStatusSidebar, flagColor, formatCombat } from './PlayerStatusSidebar.js'

/**
 * The declarations of every top-level rule of the sidebar stylesheet whose selector is exactly
 * `selector`, joined: a rule that is later split or moved still counts, and a longer selector that
 * ends in the same text (`.a .pss-value`) or a rule nested in an at-rule does not.
 */
function cssRules(selector: string): string {
  const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Array.from(css.matchAll(new RegExp(`^${escaped} \\{([^}]*)\\}`, 'gm')), (match) => match[1] ?? '').join('\n')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // The collapsed state of the panel is kept in localStorage.
  localStorage.clear()
})

/** The full name of each investment (tooltip, alt, aria-label) and the abbreviation its label slot shows. */
const INVESTMENT_ABBREVIATIONS = new Map([
  ['Endowment for the Arts', 'EftA'],
  ['Infrastructure', 'Infra'],
  ['Military-Industrial Complex', 'MIC'],
  ['Public Education', 'PE'],
])

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
  ])('shows every status value (Trade, Culture, units, modifiers, investments) with an accessible icon name for %s', (_who, props) => {
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
      ['Endowment for the Arts', '6'],
      ['Infrastructure', '8'],
      ['Military-Industrial Complex', '9'],
      ['Public Education', '10'],
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
    expect(item.querySelector('.pss-value')?.textContent).toBe('–')
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
    expect(/\.pss-grid \{[^}]*\}/.exec(css)?.[0]).toContain('--pss-box: calc(1.9rem * var(--pss-scale, 1))')
    expect(/\.pss-value \{[^}]*\}/.exec(css)?.[0]).toContain('calc(0.85rem * var(--pss-scale, 1))')
    const layout = readFileSync('src/styles.css', 'utf8').replaceAll('\r\n', '\n')
    // Only the wide layout reads the width; the stacked one at 900px and below is `width: auto`.
    const wide = /\.board-main > \.player-status-sidebar \{[^}]*\}/.exec(layout)?.[0] ?? ''
    expect(wide).toContain('width: var(--pss-width, 16.5rem)')
    const stacked = /@media \(max-width: 900px\) \{[\s\S]*?\n\}\n/.exec(layout.slice(layout.indexOf('.board-main {')))?.[0] ?? ''
    expect(stacked).toContain('width: auto')
    expect(stacked).not.toContain('--pss-width')
  })

  it('names the four investments in full in every tooltip and accessible name, and shows the abbreviation as the label', () => {
    render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    const alice = within(block('Alice'))
    const names = ['Endowment for the Arts', 'Infrastructure', 'Military-Industrial Complex', 'Public Education']
    const values = ['6', '8', '9', '10']
    names.forEach((name, index) => {
      const icon = alice.getByRole('img', { name })
      expect(icon.getAttribute('src')).toMatch(/\/status-icons\/(efta|infra|mic|pe)\.png$/)
      expect(icon.getAttribute('title')).toBe(name)
      expect(icon.closest('li')?.getAttribute('title')).toBe(name)
      // What is shown above the icon is the abbreviation; it is aria-hidden, so it is not the name.
      const label = icon.closest('li')?.querySelector('.pss-label')
      expect(label?.textContent).toBe(INVESTMENT_ABBREVIATIONS.get(name))
      expect(label?.getAttribute('aria-hidden')).toBe('true')
      expect(alice.getByRole('button', { name: `Edit Alice ${name}, currently ${values[index]}` })).toBeTruthy()
    })
    // The old abbreviations are gone from every accessible name.
    expect(alice.queryByRole('img', { name: /^(EftA|Infra|MIC|PE)$/ })).toBeNull()
    expect(alice.queryByRole('button', { name: /Edit Alice (EftA|Infra|MIC|PE),/ })).toBeNull()

    fireEvent.click(alice.getByRole('button', { name: 'Edit Alice Military-Industrial Complex, currently 9' }))
    expect(screen.getByRole('group', { name: 'Edit Alice Military-Industrial Complex' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Alice Military-Industrial Complex' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done editing Alice Military-Industrial Complex' })).toBeTruthy()
  })

  it('has a label slot in every cell with the name of the value (the abbreviation for an investment), hidden from assistive technology', () => {
    const { container } = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    const alice = block('Alice')
    const cells = Array.from(alice.querySelectorAll('li.pss-stat'))
    expect(cells).toHaveLength(16)
    for (const cell of cells) {
      const labels = cell.querySelectorAll('.pss-label')
      expect(labels).toHaveLength(1)
      const label = labels[0] as HTMLElement
      expect(label.getAttribute('aria-hidden')).toBe('true')
      // The label is the name of the stat, except that an investment shows its abbreviation.
      expect(label.textContent).toBe(INVESTMENT_ABBREVIATIONS.get(cell.getAttribute('title') ?? '') ?? cell.getAttribute('title'))
      // Label slot, then icon box, then value: the structure that keeps rows aligned.
      expect(Array.from(cell.querySelector('.pss-stat-body')?.children ?? []).map((child) => child.className)).toEqual([
        'pss-label',
        'pss-icon-box',
        'pss-value',
      ])
    }
    expect(Array.from(alice.querySelectorAll('.pss-label')).map((label) => label.textContent)).toEqual(
      expect.arrayContaining(['EftA', 'Infra', 'MIC', 'PE', 'Aircraft locked']),
    )
    // The full names are only in the tooltip and the accessible text, never shown as a label.
    expect(Array.from(alice.querySelectorAll('.pss-label')).map((label) => label.textContent)).not.toEqual(
      expect.arrayContaining(['Endowment for the Arts']),
    )
    // A hidden label is not read a second time: the cell is still found by its single accessible name.
    expect(screen.getAllByRole('button', { name: 'Edit Alice Trade, currently 7' })).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: 'Trade' })).toHaveLength(2)
    expect(container.querySelectorAll('.pss-label[aria-hidden="true"]')).toHaveLength(container.querySelectorAll('.pss-label').length)
  })

  it('keeps the label slot in the cells of a viewer who cannot edit, calculated cells included', () => {
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)
    const coins = within(block('Alice')).getByRole('img', { name: 'Coins' }).closest('li')
    expect(coins?.querySelector('.pss-label')?.textContent).toBe('Coins')
    expect(coins?.querySelector('.pss-icon-box .pss-icon')).toBeTruthy()
  })

  it('draws every icon in a fixed square box so icons of any native size end up the same size and on one line', () => {
    const rule = cssRules
    // One size for the box and for the grid row that holds it, both from the icon size setting.
    expect(rule('.pss-grid')).toContain('--pss-box: calc(1.9rem * var(--pss-scale, 1))')
    expect(rule('.pss-grid')).toContain('grid-auto-rows:')
    const box = rule('.pss-icon-box')
    expect(box).toContain('width: var(--pss-box)')
    expect(box).toContain('height: var(--pss-box)')
    expect(box).toContain('align-items: center')
    expect(box).toContain('justify-content: center')
    expect(box).toContain('grid-row: 2')
    const icon = rule('.pss-icon')
    expect(icon).toContain('width: 100%')
    expect(icon).toContain('height: 100%')
    expect(icon).toContain('object-fit: contain')
    // The calculated (read-only) cells share the editable cells' padding and border, so they line up.
    expect(rule('.pss-stat-body')).toContain('padding: 0.15rem 0')
    expect(rule('.pss-stat-body')).toContain('border: 1px solid transparent')
  })

  it('shares the rows of a grid row between its cells, so labels and values line up and nothing shifts', () => {
    const rule = cssRules
    // Each cell spans label, icon and value rows of the grid; a row of cells has one label height.
    for (const selector of ['.pss-stat', '.pss-stat-body']) {
      expect(rule(selector)).toContain('grid-template-rows: subgrid')
    }
    expect(rule('.pss-stat')).toContain('grid-row: span 3')
    expect(rule('.pss-label')).toContain('grid-row: 1')
    expect(rule('.pss-value')).toContain('grid-row: 3')
    // Labels sit on the icon, so a one-line label is not left floating at the top of a taller slot.
    expect(rule('.pss-label')).toContain('align-self: end')
  })

  it('shows the labels only when .board-main turns them on, small, centred and wrapped', () => {
    const rule = cssRules
    // Off: no space at all (the row of the slot collapses), so the layout is as compact as without labels.
    expect(rule('.pss-label')).toContain('display: none')
    expect(rule("[data-pss-labels='on'] .pss-label")).toContain('display: block')
    const label = rule('.pss-label')
    expect(label).toContain('font-size: 0.68rem')
    expect(label).toContain('line-height: 1.15')
    expect(label).toContain('text-align: center')
    expect(label).toContain('overflow-wrap: anywhere')
    expect(label).toContain('hyphens: auto')
    // With labels on a narrow block has two columns and a wide one four.
    expect(rule("[data-pss-labels='on'] .pss-grid")).toContain('repeat(2, minmax(0, 1fr))')
    const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
    expect(css).toMatch(/@container \(min-width: 21rem\) \{\s*\[data-pss-labels='on'\] \.pss-grid \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/)
    expect(rule('.pss-block')).toContain('container-type: inline-size')
    // The editor still spans the whole grid, whatever the number of columns.
    expect(rule('.pss-editor')).toContain('grid-column: 1 / -1')
  })

  it('writes the labels in English so the browser hyphenates them with the English dictionary', () => {
    render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)
    expect(block('Alice').querySelector('.pss-label')?.getAttribute('lang')).toBe('en')
  })

  it('is plain display when readOnly: no inputs, selects or api calls, and only the collapse toggle and the government reference button', () => {
    const methods = api as unknown as Record<string, (...args: unknown[]) => unknown>
    const calls = Object.keys(methods)
      .filter((key) => typeof methods[key] === 'function')
      .map((key) => vi.spyOn(methods, key))
    expect(calls.length).toBeGreaterThan(50)
    const { container } = render(<PlayerStatusSidebar {...READ_ONLY} view={makeView()} />)

    expect(container.querySelectorAll('input, select, textarea, a')).toHaveLength(0)
    const buttons = [...container.querySelectorAll('button')]
    // The toggle is named by its text, the others by their aria-label.
    expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      expect.stringContaining('Player overview'),
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
    expect(stat('Edit Bob Public Education, currently 0')).toBeTruthy()
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

    open('Edit Alice Infrastructure, currently 8')
    fireEvent.change(field('Alice Infrastructure'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done editing Alice Infrastructure' }))
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

    open('Edit Bob Public Education, currently 0')
    expect((screen.getByRole('button', { name: 'Decrease Bob Public Education' }) as HTMLButtonElement).disabled).toBe(true)
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

    open('Edit Bob Endowment for the Arts, currently 0')
    fireEvent.change(field('Bob Endowment for the Arts'), { target: { value: '2' } })
    fireEvent.keyDown(field('Bob Endowment for the Arts'), { key: 'Enter' })

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

  it('opens the reference when the Social policy panel asks for it, whether or not the sidebar is collapsed', () => {
    localStorage.setItem('civ.panel.player-status', 'false')
    try {
      render(<PlayerStatusSidebar {...READ_ONLY} view={view} />)
      expect(document.querySelector('.pss-content')?.hasAttribute('hidden')).toBe(true)
      expect(screen.queryByRole('dialog')).toBeNull()
      const opener = document.createElement('button')
      document.body.append(opener)
      opener.focus()

      act(() => openGovernmentReference())

      expect(screen.getByRole('dialog', { name: 'Government card reference' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener)
      opener.remove()
    } finally {
      localStorage.removeItem('civ.panel.player-status')
    }
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
    const rule = cssRules
    // The button is a subgrid and as tall as the rows it spans, so its own min-height cannot make it
    // 44px. The value row has the floor instead: 44px minus the icon box and the top padding (0.15rem)
    // and border (1px) the label row already holds, plus the 0.25rem margin under the cell, which is
    // part of the spanned tracks. The numbers below are the ones that formula is made of.
    expect(rule('.pss-grid')).toContain(
      'minmax(max(0px, calc(44px - var(--pss-box) - 0.15rem - 1px + 0.25rem)), auto)',
    )
    expect(rule('.pss-stat')).toContain('margin-bottom: 0.25rem')
    expect(rule('.pss-stat-body')).toContain('padding: 0.15rem 0')
    expect(rule('.pss-stat-body')).toContain('border: 1px solid transparent')
    expect(rule('.pss-stat-body')).toContain('box-sizing: border-box')
    // The value (not a stretched subgrid) is what sits in that row.
    expect(rule('.pss-value')).toContain('grid-row: 3')
    // Without subgrid support the button is an ordinary box and its own minimum applies.
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

describe('PlayerStatusSidebar collapsing', () => {
  const STORAGE_KEY = 'civ.panel.player-status'
  const toggle = (name: string): HTMLElement => screen.getByRole('button', { name })
  const content = (container: HTMLElement): HTMLElement => container.querySelector('.pss-content') as HTMLElement
  const css = readFileSync('src/views/PlayerStatusSidebar.css', 'utf8').replaceAll('\r\n', '\n')
  /** The part of the stylesheet that applies at 900px and below, and the part that applies always. */
  const stackedCss = /@media \(max-width: 900px\) \{[\s\S]*?\n\}\n/.exec(css)?.[0] ?? ''
  const baseCss = css.replace(stackedCss, '')
  const ruleIn = (source: string, selector: string): string =>
    Array.from(
      source.matchAll(new RegExp(`^ {0,2}${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'gm')),
      (match) => match[1] ?? '',
    ).join('\n')

  it('is open by default, with a toggle named by the heading text that points at the content', () => {
    const { container } = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    const button = toggle('Player overview')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // No aria-label of its own: the heading text names it, and aria-expanded carries the state.
    expect(button.hasAttribute('aria-label')).toBe(false)
    expect(content(container).hidden).toBe(false)
    expect(button.getAttribute('aria-controls')).toBe(content(container).id)
    expect(container.querySelector(`#${content(container).id}`)).toBe(content(container))
    // The name does not flip with the state, and is not the heading of another panel.
    expect(screen.getByRole('heading', { name: 'Player overview', level: 2 })).toBeTruthy()
    fireEvent.click(button)
    expect(screen.getByRole('heading', { name: 'Player overview', level: 2 })).toBeTruthy()
    expect(toggle('Player overview').getAttribute('aria-expanded')).toBe('false')
  })

  it('collapses and expands with a click or the keyboard, and the blocks stay in the document', () => {
    const { container } = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    fireEvent.click(toggle('Player overview'))
    expect(content(container).hidden).toBe(true)
    expect(toggle('Player overview').getAttribute('aria-expanded')).toBe('false')
    // Hidden by the attribute, not removed: beside the map the stylesheet shows it regardless.
    expect(within(content(container)).getAllByRole('region', { hidden: true })).toHaveLength(2)

    // A real button, so Enter and Space activate it; jsdom turns the click such a key press makes
    // into the same event, which is all the component handles.
    expect(toggle('Player overview').tagName).toBe('BUTTON')
    fireEvent.click(toggle('Player overview'))
    expect(content(container).hidden).toBe(false)
    expect(toggle('Player overview').getAttribute('aria-expanded')).toBe('true')
  })

  it('remembers the choice in localStorage like the other panels, and reads it back', () => {
    const first = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    fireEvent.click(toggle('Player overview'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
    first.unmount()

    const second = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    expect(content(second.container).hidden).toBe(true)
    expect(toggle('Player overview').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle('Player overview'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('works with storage that throws: open to begin with, and it still collapses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const { container } = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    expect(content(container).hidden).toBe(false)
    fireEvent.click(toggle('Player overview'))
    expect(content(container).hidden).toBe(true)
  })

  it('closes an open editor when the panel collapses, as a browser does it: the press blurs and saves, then the click collapses', () => {
    const save = vi.spyOn(api, 'setPlayerStat').mockResolvedValue(makeView())
    const { container } = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Alice Trade, currently 7' }))
    const field = screen.getByRole('textbox', { name: 'Alice Trade' })
    fireEvent.change(field, { target: { value: '9' } })
    expect(screen.getByRole('group', { name: 'Edit Alice Trade' })).toBeTruthy()

    // Pressing the toggle moves focus to it first: leaving the editor saves the typed value (the
    // editor's design) and closes it. Only then does the click collapse the panel.
    fireEvent.blur(field, { relatedTarget: toggle('Player overview') })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('game-1', 'player-me', 'trade', 9)
    fireEvent.click(toggle('Player overview'))
    expect(container.querySelector('.pss-editor')).toBeNull()
    fireEvent.click(toggle('Player overview'))
    expect(container.querySelector('.pss-editor')).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Alice Trade, currently 7' }).getAttribute('aria-expanded')).toBe('false')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('closes an editor that is still open when the panel collapses without a blur, saving nothing', () => {
    const save = vi.spyOn(api, 'setPlayerStat').mockResolvedValue(makeView())
    const { container } = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Alice Trade, currently 7' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Alice Trade' }), { target: { value: '9' } })
    // Where no blur comes first (a browser that sends focus nowhere, or a script), the collapse
    // itself closes the editor and drops the draft.
    fireEvent.click(toggle('Player overview'))
    expect(container.querySelector('.pss-editor')).toBeNull()
    fireEvent.click(toggle('Player overview'))
    expect(container.querySelector('.pss-editor')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('does not open a tap that was waiting for a save inside the collapsed panel, nor on expanding', () => {
    const save = vi.spyOn(api, 'setPlayerStat').mockResolvedValue(makeView())
    const view = makeView()
    const { container, rerender } = render(<PlayerStatusSidebar {...EDITABLE} view={view} />)
    // Editor A (Trade) is open; tapping stat B (Culture) blurs A, which saves and makes the sidebar busy.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Alice Trade, currently 7' }))
    const field = screen.getByRole('textbox', { name: 'Alice Trade' })
    fireEvent.change(field, { target: { value: '9' } })
    const cultureCell = screen.getByRole('button', { name: 'Edit Alice Culture, currently 11' })
    fireEvent.mouseDown(cultureCell)
    fireEvent.blur(field, { relatedTarget: cultureCell })
    expect(save).toHaveBeenCalledTimes(1)
    rerender(<PlayerStatusSidebar {...EDITABLE} busy view={view} />)
    // The click that follows is kept for when the save is done...
    fireEvent.click(cultureCell)
    // ...but the user collapses the panel before that.
    fireEvent.click(toggle('Player overview'))
    rerender(<PlayerStatusSidebar {...EDITABLE} view={view} />)
    expect(container.querySelector('.pss-editor')).toBeNull()
    fireEvent.click(toggle('Player overview'))
    expect(container.querySelector('.pss-editor')).toBeNull()
  })

  it('leaves the government reference dialog outside the collapsible content', () => {
    const { container } = render(<PlayerStatusSidebar {...EDITABLE} view={makeView()} />)
    fireEvent.click(within(block('Alice')).getByRole('button', { name: 'Show government card reference' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(content(container).contains(screen.getByRole('dialog'))).toBe(false)
  })

  it('hides the heading above 900px and shows the content whatever the stored state says', () => {
    // Always: no heading (display: none, so it is not exposed to assistive technology either),
    // and a content rule whose `display` overrides the UA rule of the `hidden` attribute.
    expect(ruleIn(baseCss, '.pss-panel-heading')).toContain('display: none')
    expect(ruleIn(baseCss, '.pss-content')).toContain('display: flex')
    expect(baseCss).not.toMatch(/\.pss-content\[hidden\]/)
    expect(ruleIn(baseCss, '.pss-panel-toggle')).toBe('')
    // At 900px and below: the heading is back and the collapsed content is hidden again.
    expect(stackedCss).toContain('(max-width: 900px)')
    expect(ruleIn(stackedCss, '.pss-panel-heading')).toContain('display: block')
    expect(ruleIn(stackedCss, '.pss-content[hidden]')).toContain('display: none')
    expect(ruleIn(stackedCss, '.pss-content')).toContain('grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr))')
  })

  it('makes the toggle a full-width button of at least 44px where it is shown', () => {
    const toggleRule = ruleIn(stackedCss, '.pss-panel-toggle')
    expect(toggleRule).toContain('min-height: 44px')
    expect(toggleRule).toContain('width: 100%')
  })

  it('keeps the breakpoint of the stacked sidebar and the wide layout unchanged', () => {
    const layout = readFileSync('src/styles.css', 'utf8').replaceAll('\r\n', '\n')
    // The same 900px as styles.css, whose rules stack .board-main and release the sidebar's max-height.
    const wide = /\.board-main > \.player-status-sidebar \{[^}]*\}/.exec(layout)?.[0] ?? ''
    expect(wide).toContain('max-height: 80vh')
    expect(wide).toContain('overflow-y: auto')
    const stacked = /@media \(max-width: 900px\) \{[\s\S]*?\n\}\n/.exec(layout.slice(layout.indexOf('.board-main {')))?.[0] ?? ''
    expect(stacked).toContain('max-height: none')
  })
})

describe('About page credits', () => {
  it('credits the stacking and combat hand size icons', () => {
    render(<AboutView />)

    expect(screen.getByText('Stacking icon: Layer icon by riajulislam, from Magnific (Freepik)')).toBeTruthy()
    expect(screen.getByText('Combat hand size icon: Swords icon from Magnific (Freepik)')).toBeTruthy()
  })
})
