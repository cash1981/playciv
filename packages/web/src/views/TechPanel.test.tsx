// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { TechPanel } from './TechPanel.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tech = (name: string, hidden: boolean, level: 1 | 2 | 3 | 4 | 5 = 1): TechItem => ({
  id: `tech-${name}`,
  name,
  level,
  hidden,
  itemNumber: 1,
  description: null,
  used: false,
  ownerId: 'me',
  sheetName: 'LEVEL_1_TECH',
  kind: 'tech',
  type: null,
})

/** One opponent exactly as `toPlayerView` sends them: revealed techs, count only. */
const opponent = (
  playerId: string,
  username: string,
  options: {
    readonly color?: string
    readonly civilization?: string | null
    readonly revealedTechs?: readonly TechItem[]
    readonly numberOfTechsChosen?: number
  } = {},
) => ({
  playerId,
  username,
  color: options.color ?? 'Blue',
  civilization:
    options.civilization === null
      ? null
      : { name: options.civilization ?? `${username}land` },
  revealedTechs: options.revealedTechs ?? [],
  numberOfTechsChosen: options.numberOfTechsChosen ?? options.revealedTechs?.length ?? 0,
})

const view = (techsChosen: readonly TechItem[], opponents: readonly unknown[] = []): PlayerView =>
  ({
    you: {
      playerId: 'me',
      username: 'cash1981',
      color: 'Red',
      civilization: { name: 'Rome' },
      techsChosen,
    },
    opponents,
  }) as unknown as PlayerView

/** A signed-out spectator: no `you`, so no tab of their own. */
const spectatorView = (opponents: readonly unknown[] = []): PlayerView =>
  ({ you: null, opponents }) as unknown as PlayerView

const run = async (action: () => Promise<unknown>): Promise<void> => {
  await action()
}

interface PanelOptions {
  readonly techsChosen?: readonly TechItem[]
  readonly opponents?: readonly unknown[]
  readonly spectator?: boolean
}

function renderPanel({
  techsChosen = [],
  opponents = [],
  spectator = false,
}: PanelOptions = {}): HTMLElement {
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  const { container } = render(
    <TechPanel
      gameId="game-1"
      busy={false}
      run={run}
      view={spectator ? spectatorView(opponents) : view(techsChosen, opponents)}
      reloadCount={0}
    />,
  )
  return container
}

function tabNames(): (string | null)[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent)
}

function selectedTab(): HTMLElement {
  const tab = screen
    .getAllByRole('tab')
    .find((candidate) => candidate.getAttribute('aria-selected') === 'true')
  if (tab === undefined) throw new Error('no tab is selected')
  return tab
}

function activePanel(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')
  if (panel === null) throw new Error('the tab panel is not rendered')
  return panel
}

describe('TechPanel tabs', () => {
  it('opens on the viewer\'s own tab: pyramid in full, list without revealed techs', () => {
    const container = renderPanel({
      techsChosen: [tech('Horseback Riding', true), tech('Agriculture', false)],
    })

    expect(tabNames()).toEqual(['cash1981'])
    expect(selectedTab().textContent).toBe('cash1981')

    const panel = activePanel(container)
    expect(panel.querySelector('.tech-pyramid')?.textContent).toContain('Agriculture')
    expect(panel.querySelector('.tech-pyramid')?.textContent).toContain('Horseback Riding')
    const list = panel.querySelector('ul.list.scroll')
    expect(list?.textContent).toContain('Horseback Riding')
    expect(list?.textContent).not.toContain('Agriculture')
  })

  it('says all researched techs are revealed when no hidden one is left', () => {
    const container = renderPanel({ techsChosen: [tech('Writing', false)] })

    expect(activePanel(container).querySelector('ul.list.scroll')?.textContent).toContain(
      'All researched techs are revealed.',
    )
  })

  it('says none chosen when nothing has been researched', () => {
    const container = renderPanel()

    expect(activePanel(container).querySelector('ul.list.scroll')?.textContent).toContain(
      'None chosen.',
    )
  })

  it('shows one tab per player and swaps the pyramid when another is selected', () => {
    const container = renderPanel({
      techsChosen: [tech('Writing', false)],
      opponents: [
        opponent('p2', 'Egil', { color: 'Blue', revealedTechs: [tech('Masonry', false)] }),
        opponent('p3', 'Kari', { color: 'Green', revealedTechs: [tech('Archery', false)] }),
      ],
    })

    expect(tabNames()).toEqual(['cash1981', 'Egil', 'Kari'])
    expect(activePanel(container).textContent).toContain('Writing')

    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))

    expect(selectedTab().textContent).toBe('Egil')
    expect(activePanel(container).textContent).toContain('Masonry')
    // The viewer's own pyramid is not stacked below any more (issue #140).
    expect(activePanel(container).textContent).not.toContain('Writing')

    fireEvent.click(screen.getByRole('tab', { name: 'Kari' }))
    expect(activePanel(container).textContent).toContain('Archery')
  })

  it('offers no reveal or remove controls on another player\'s tab', () => {
    renderPanel({
      opponents: [opponent('p2', 'Egil', { revealedTechs: [tech('Masonry', false, 2)] })],
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))

    expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('says an opponent has researched but not revealed, using only the public count', () => {
    const container = renderPanel({
      opponents: [opponent('p2', 'Egil', { numberOfTechsChosen: 2 })],
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))

    expect(activePanel(container).textContent).toContain(
      'Has researched technologies, but not revealed any.',
    )
    // No hidden tech exists in the data, and the panel never invents one.
    expect(activePanel(container).querySelector('.tech-slot.researched.hidden')).toBeNull()
  })

  it('gives a spectator a tab per player and keeps the picker', () => {
    renderPanel({
      spectator: true,
      opponents: [opponent('p2', 'Egil'), opponent('p3', 'Kari')],
    })

    expect(tabNames()).toEqual(['Egil', 'Kari'])
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('moves between tabs with the arrow keys', () => {
    renderPanel({
      opponents: [opponent('p2', 'Egil'), opponent('p3', 'Kari')],
    })

    fireEvent.keyDown(screen.getByRole('tab', { name: 'cash1981' }), { key: 'ArrowRight' })

    expect(selectedTab().textContent).toBe('Egil')
  })

  it('researches the chosen tech through the shared runner', async () => {
    const choose = vi.spyOn(api, 'chooseTech').mockResolvedValue({} as PlayerView)
    vi.spyOn(api, 'availableTechs').mockResolvedValue([tech('Writing', false)])
    render(
      <TechPanel
        gameId="game-1"
        busy={false}
        run={run}
        view={view([])}
        reloadCount={0}
      />,
    )

    await screen.findByRole('option', { name: 'Level 1 — Writing' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Writing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))

    await waitFor(() => expect(choose).toHaveBeenCalledWith('game-1', 'Writing'))
  })
})
