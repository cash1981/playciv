// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
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

/** The viewer's own techs, with empty lists for everything the panel fetches. */
const view = (techsChosen: readonly TechItem[]): PlayerView =>
  ({ you: { techsChosen } }) as unknown as PlayerView

const run = async (): Promise<void> => undefined

/** The "Yours" list, as opposed to the pyramid above it. */
function yoursList(container: HTMLElement): HTMLElement {
  const list = container.querySelector<HTMLElement>('ul.list.scroll')
  if (list === null) throw new Error('the Yours list is not rendered')
  return list
}

function renderPanel(techsChosen: readonly TechItem[]): HTMLElement {
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  vi.spyOn(api, 'revealedTechs').mockResolvedValue([])
  vi.spyOn(api, 'socialPolicies').mockResolvedValue([])
  const { container } = render(
    <TechPanel gameId="game-1" busy={false} run={run} view={view(techsChosen)} reloadCount={0} />,
  )
  return container
}

describe('TechPanel Yours list', () => {
  it('drops the row of a revealed tech but keeps it on the pyramid', () => {
    const container = renderPanel([tech('Horseback Riding', true), tech('Agriculture', false)])

    const list = yoursList(container)
    expect(list.textContent).toContain('Horseback Riding')
    expect(list.textContent).not.toContain('Agriculture')
    // The revealed tech is still visible above, on the viewer's own pyramid.
    expect(container.querySelector('.tech-pyramid')?.textContent).toContain('Agriculture')
  })

  it('says all researched techs are revealed when no hidden one is left', () => {
    const container = renderPanel([tech('Writing', false)])

    expect(yoursList(container).textContent).toContain('All researched techs are revealed.')
  })

  it('says none chosen when nothing has been researched', () => {
    const container = renderPanel([])

    expect(yoursList(container).textContent).toContain('None chosen.')
  })
})
