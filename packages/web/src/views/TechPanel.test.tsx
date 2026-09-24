// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { TechPanel } from './TechPanel.js'

beforeEach(() => localStorage.setItem('civ.panel.techs', 'true'))
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.techs')
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
    expect(screen.getByRole('button', { name: 'Level 1' })).toBeTruthy()
  })

  it('moves between tabs with the arrow keys', () => {
    renderPanel({
      opponents: [opponent('p2', 'Egil'), opponent('p3', 'Kari')],
    })

    fireEvent.keyDown(screen.getByRole('tab', { name: 'cash1981' }), { key: 'ArrowRight' })

    expect(selectedTab().textContent).toBe('Egil')
  })
})

describe('TechPanel picker', () => {
  it('shows level tabs 1-5, defaulting to level 1, and filters the card grid by the active level', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([
      tech('Writing', false, 1),
      tech('Sailing', false, 2),
    ])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    await screen.findByText('Writing')
    for (const level of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: `Level ${level}` })).toBeTruthy()
    }
    expect(screen.queryByText('Sailing')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Level 2' }))

    expect(screen.queryByText('Writing')).toBeNull()
    expect(screen.getByText('Sailing')).toBeTruthy()
  })

  it('says nothing is available at a level with no techs left', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    await screen.findByText('No level 1 techs available to research.')
  })

  it('opens a detail dialog with the card art, level and effect text on click', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([tech('Writing', false, 1)])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    fireEvent.click(await screen.findByText('Writing'))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Writing — Level 1')
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/items/Writing.jpg')
    // Writing has an entry in TECH_TEXT — spot check a fragment of it rather
    // than the whole transcribed paragraph.
    expect(dialog.textContent).toContain('Library building')
  })

  it("shows no effect-text paragraph for Space Flight, and never falls back to tech.description", async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([
      { ...tech('Space Flight', false, 5), description: 'should never be shown' },
    ])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    await screen.findByRole('button', { name: 'Level 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Level 5' }))
    fireEvent.click(screen.getByText('Space Flight'))

    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('.reference-card-copy p')).toBeNull()
    expect(dialog.textContent).not.toContain('should never be shown')
  })

  it('researches the chosen tech through the shared runner and closes the dialog', async () => {
    const choose = vi.spyOn(api, 'chooseTech').mockResolvedValue({} as PlayerView)
    vi.spyOn(api, 'availableTechs').mockResolvedValue([tech('Writing', false, 1)])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    fireEvent.click(await screen.findByText('Writing'))
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))

    await waitFor(() => expect(choose).toHaveBeenCalledWith('game-1', 'Writing'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables Research while busy', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([tech('Writing', false, 1)])
    render(<TechPanel gameId="game-1" busy={true} run={run} view={view([])} reloadCount={0} />)

    fireEvent.click(await screen.findByText('Writing'))

    expect((screen.getByRole('button', { name: 'Research' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
