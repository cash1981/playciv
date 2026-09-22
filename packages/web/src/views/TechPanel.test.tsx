// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView, RevealedTechsDto } from '../lib/api.js'
import { TechPanel } from './TechPanel.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tech = (name: string, hidden: boolean): TechItem => ({
  id: `tech-${name}`,
  name,
  level: 1,
  hidden,
  itemNumber: 1,
  description: null,
  used: false,
  ownerId: 'player-me',
  sheetName: 'LEVEL_1_TECH',
  kind: 'tech',
  type: null,
})

/** The viewer's own techs and civilization. Everything else is fetched. */
const view = (techsChosen: readonly TechItem[], civilization: string | null): PlayerView =>
  ({
    you: { techsChosen, civilization: civilization === null ? null : { name: civilization } },
  }) as unknown as PlayerView

/** A signed-out spectator: no `you`, so no civilization of their own. */
const spectatorView = (): PlayerView => ({ you: null }) as unknown as PlayerView

const run = async (): Promise<void> => undefined

/** The "Yours" list, as opposed to the pyramid above it. */
function yoursList(container: HTMLElement): HTMLElement {
  const list = container.querySelector<HTMLElement>('ul.list.scroll')
  if (list === null) throw new Error('the Yours list is not rendered')
  return list
}

interface PanelOptions {
  readonly techsChosen?: readonly TechItem[]
  readonly civilization?: string | null
  readonly revealed?: readonly RevealedTechsDto[]
  readonly spectator?: boolean
}

function renderPanel({
  techsChosen = [],
  civilization = null,
  revealed = [],
  spectator = false,
}: PanelOptions = {}): HTMLElement {
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  vi.spyOn(api, 'revealedTechs').mockResolvedValue([...revealed])
  vi.spyOn(api, 'socialPolicies').mockResolvedValue([])
  const { container } = render(
    <TechPanel
      gameId="game-1"
      busy={false}
      run={run}
      view={spectator ? spectatorView() : view(techsChosen, civilization)}
      reloadCount={0}
    />,
  )
  return container
}

describe('TechPanel Yours list', () => {
  it('drops the row of a revealed tech but keeps it on the pyramid', () => {
    const container = renderPanel({
      techsChosen: [tech('Horseback Riding', true), tech('Agriculture', false)],
    })

    const list = yoursList(container)
    expect(list.textContent).toContain('Horseback Riding')
    expect(list.textContent).not.toContain('Agriculture')
    // The revealed tech is still visible above, on the viewer's own pyramid.
    expect(container.querySelector('.tech-pyramid')?.textContent).toContain('Agriculture')
  })

  it('says all researched techs are revealed when no hidden one is left', () => {
    const container = renderPanel({ techsChosen: [tech('Writing', false)] })

    expect(yoursList(container).textContent).toContain('All researched techs are revealed.')
  })

  it('says none chosen when nothing has been researched', () => {
    const container = renderPanel()

    expect(yoursList(container).textContent).toContain('None chosen.')
  })
})

describe('TechPanel Revealed by other players', () => {
  it('shows an opponent pyramid but not the viewer own', async () => {
    renderPanel({
      civilization: 'Rome',
      revealed: [
        { civilization: 'Rome', color: 'Red', techs: [{ name: 'Writing', level: 1 }] },
        { civilization: 'Egypt', color: 'Blue', techs: [{ name: 'Masonry', level: 1 }] },
      ],
    })

    expect(await screen.findByText('Egypt')).toBeTruthy()
    // The viewer's own pyramid stays under "Yours" only.
    expect(screen.queryByText('Rome')).toBeNull()
  })

  it('says no other player has chosen a civilization when only the viewer has', async () => {
    renderPanel({
      civilization: 'Rome',
      revealed: [{ civilization: 'Rome', color: 'Red', techs: [] }],
    })

    expect(
      await screen.findByText('No other player has chosen a civilization yet.'),
    ).toBeTruthy()
  })

  it('shows every pyramid to a spectator with no civilization of their own', async () => {
    renderPanel({
      spectator: true,
      revealed: [
        { civilization: 'Rome', color: 'Red', techs: [{ name: 'Writing', level: 1 }] },
        { civilization: 'Egypt', color: 'Blue', techs: [{ name: 'Masonry', level: 1 }] },
      ],
    })

    expect(await screen.findByText('Rome')).toBeTruthy()
    expect(screen.getByText('Egypt')).toBeTruthy()
  })
})
