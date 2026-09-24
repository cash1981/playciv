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
    /** Mirrors `OpaquePlayerhand.pyramidPlacements`: slot only, no name. */
    readonly pyramidPlacements?: readonly { readonly slot: number }[]
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
  pyramidPlacements: options.pyramidPlacements ?? [],
})

const view = (
  techsChosen: readonly TechItem[],
  opponents: readonly unknown[] = [],
  pyramidPlacements: readonly { readonly name: string; readonly slot: number }[] = [],
): PlayerView =>
  ({
    you: {
      playerId: 'me',
      username: 'cash1981',
      color: 'Red',
      civilization: { name: 'Rome' },
      techsChosen,
      pyramidPlacements,
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
  readonly pyramidPlacements?: readonly { readonly name: string; readonly slot: number }[]
}

function renderPanel({
  techsChosen = [],
  opponents = [],
  spectator = false,
  pyramidPlacements = [],
}: PanelOptions = {}): HTMLElement {
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  const { container } = render(
    <TechPanel
      gameId="game-1"
      busy={false}
      run={run}
      view={spectator ? spectatorView(opponents) : view(techsChosen, opponents, pyramidPlacements)}
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

/**
 * New in this port — see the pyramid-reposition task brief. The stepper is
 * rendered only on the viewer's own tab, never an opponent's, because
 * `onTechSlotChange`/`onPlacementSlotChange` are only passed when `active.own`.
 */
describe('TechPanel pyramid repositioning (#168 follow-up)', () => {
  it('shows the stepper control on the own tab and calls setTechSlot with the new slot', () => {
    const setTechSlot = vi.spyOn(api, 'setTechSlot').mockResolvedValue({} as PlayerView)
    const container = renderPanel({ techsChosen: [tech('Writing', false)] })

    const buttons = activePanel(container).querySelectorAll('.tech-slot-move button')
    expect(buttons.length).toBeGreaterThan(0)
    fireEvent.click(buttons[1] as Element) // ▲, move to a higher row

    expect(setTechSlot).toHaveBeenCalledWith('game-1', 'Writing', 2)
  })

  it('does not show the stepper on an opponent\'s tab', () => {
    const container = renderPanel({
      opponents: [opponent('p2', 'Egil', { revealedTechs: [tech('Masonry', false)] })],
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))

    expect(activePanel(container).querySelector('.tech-slot-move')).toBeNull()
  })

  it('renders a placed Great Person with its real name on the owner\'s own tab', () => {
    const ownContainer = renderPanel({
      pyramidPlacements: [{ name: 'Sir Isaac Newton', slot: 2 }],
    })
    const ownPlacement = activePanel(ownContainer).querySelector('.tech-slot.placement')
    expect(ownPlacement?.textContent).toContain('Sir Isaac Newton')
    expect(ownPlacement?.querySelector('img')?.getAttribute('src')).toBe('/items/greatperson_back.jpg')
  })

  it('renders a placed Great Person as a generic blank occupant on an opponent\'s tab, never the real name', () => {
    const opponentContainer = renderPanel({
      opponents: [opponent('p2', 'Egil', { pyramidPlacements: [{ slot: 2 }] })],
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))
    const opponentPlacement = activePanel(opponentContainer).querySelector('.tech-slot.placement')
    expect(opponentPlacement?.textContent).not.toContain('Sir Isaac Newton')
    expect(opponentPlacement?.textContent).toContain('Blank tech card')
    expect(opponentContainer.innerHTML).not.toContain('Sir Isaac Newton')
    expect(opponentPlacement?.querySelector('img')?.getAttribute('src')).toBe('/items/greatperson_back.jpg')
  })

  it('moves a placed Great Person via the same stepper control, calling setPyramidPlacementSlot', () => {
    const setPyramidPlacementSlot = vi
      .spyOn(api, 'setPyramidPlacementSlot')
      .mockResolvedValue({} as PlayerView)
    const container = renderPanel({
      pyramidPlacements: [{ name: 'Sir Isaac Newton', slot: 2 }],
    })

    const buttons = activePanel(container).querySelectorAll('.tech-slot-move button')
    fireEvent.click(buttons[0] as Element) // ▼, move to a lower row

    expect(setPyramidPlacementSlot).toHaveBeenCalledWith('game-1', 'Sir Isaac Newton', 1)
  })
})

describe('TechPanel picker', () => {
  it('shows level tabs 1-5 with no level selected until clicked, then filters the card grid', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([
      tech('Writing', false, 1),
      tech('Sailing', false, 2),
    ])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    await screen.findByRole('button', { name: 'Level 1' })
    for (const level of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: `Level ${level}` })).toBeTruthy()
    }
    // Nothing is picked by default — the player sees their pyramid first.
    expect(screen.queryByText('Writing')).toBeNull()
    expect(screen.queryByText('Sailing')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Level 1' }))

    expect(screen.getByText('Writing')).toBeTruthy()
    expect(screen.queryByText('Sailing')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Level 2' }))

    expect(screen.queryByText('Writing')).toBeNull()
    expect(screen.getByText('Sailing')).toBeTruthy()
  })

  it('says nothing is available at a level with no techs left, once that level is picked', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    expect(screen.queryByText('No level 1 techs available to research.')).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: 'Level 1' }))

    await screen.findByText('No level 1 techs available to research.')
  })

  it('opens a detail dialog with the card art, level and effect text on click', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([tech('Writing', false, 1)])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Level 1' }))
    fireEvent.click(screen.getByText('Writing'))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Writing — Level 1')
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/items/Writing.jpg')
    // Writing has an entry in TECH_TEXT — spot check a fragment of it rather
    // than the whole transcribed paragraph.
    expect(dialog.textContent).toContain('Library building')
  })

  it("shows Space Flight's own effect text, and never falls back to tech.description", async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([
      { ...tech('Space Flight', false, 5), description: 'should never be shown' },
    ])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    await screen.findByRole('button', { name: 'Level 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Level 5' }))
    fireEvent.click(screen.getByText('Space Flight'))

    const dialog = screen.getByRole('dialog')
    // Space Flight has no entry on the printed tech reference sheet (it is
    // added in code, not from the spreadsheet), so this line is the human's
    // own text, not a transcription — see techText.ts.
    expect(dialog.textContent).toContain('Immediately win the game with a Tech victory.')
    expect(dialog.textContent).not.toContain('should never be shown')
  })

  it('researches the chosen tech through the shared runner and closes the dialog', async () => {
    const choose = vi.spyOn(api, 'chooseTech').mockResolvedValue({} as PlayerView)
    vi.spyOn(api, 'availableTechs').mockResolvedValue([tech('Writing', false, 1)])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view([])} reloadCount={0} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Level 1' }))
    fireEvent.click(screen.getByText('Writing'))
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))

    await waitFor(() => expect(choose).toHaveBeenCalledWith('game-1', 'Writing'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables Research while busy', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([tech('Writing', false, 1)])
    render(<TechPanel gameId="game-1" busy={true} run={run} view={view([])} reloadCount={0} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Level 1' }))
    fireEvent.click(screen.getByText('Writing'))

    expect((screen.getByRole('button', { name: 'Research' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('opens the same detail dialog for a tech already in the pyramid, with no Research button', async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    render(
      <TechPanel
        gameId="game-1"
        busy={false}
        run={run}
        view={view([tech('Writing', false, 1)])}
        reloadCount={0}
      />,
    )

    fireEvent.click(await screen.findByText('Writing'))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Writing — Level 1')
    expect(dialog.textContent).toContain('Library building')
    expect(screen.queryByRole('button', { name: 'Research' })).toBeNull()
  })

  it("opens the detail dialog for a tech read from an opponent's revealed pyramid", async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    render(
      <TechPanel
        gameId="game-1"
        busy={false}
        run={run}
        view={view([], [opponent('p2', 'Egil', { revealedTechs: [tech('Masonry', false, 1)] })])}
        reloadCount={0}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))
    fireEvent.click(screen.getByText('Masonry'))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Masonry — Level 1')
    expect(screen.queryByRole('button', { name: 'Research' })).toBeNull()
  })

  it("moving a researched tech's pyramid row does not also open its detail dialog", async () => {
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    vi.spyOn(api, 'setTechSlot').mockResolvedValue({} as PlayerView)
    render(
      <TechPanel
        gameId="game-1"
        busy={false}
        run={run}
        view={view([tech('Writing', false, 1)])}
        reloadCount={0}
      />,
    )

    await screen.findByText('Writing')
    fireEvent.click(screen.getByRole('button', { name: 'Move Writing to a higher pyramid row' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
