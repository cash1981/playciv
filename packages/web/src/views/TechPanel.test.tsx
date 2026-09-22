// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SocialPolicyItem, TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView, RevealedTechsDto } from '../lib/api.js'
import { itemImageUrl } from './ItemCard.js'
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

/** The viewer's own techs, civilization and chosen policies. Everything else is fetched. */
const view = (
  techsChosen: readonly TechItem[],
  civilization: string | null,
  socialPolicies: readonly SocialPolicyItem[] = [],
): PlayerView =>
  ({
    you: {
      techsChosen,
      socialPolicies,
      civilization: civilization === null ? null : { name: civilization },
    },
  }) as unknown as PlayerView

/** A signed-out spectator: no `you`, so no civilization of their own. */
const spectatorView = (): PlayerView => ({ you: null }) as unknown as PlayerView

const run = async (action: () => Promise<unknown>): Promise<void> => {
  await action()
}

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
  /** The fetched catalogue (`api.socialPolicies`), what the reference lists. */
  readonly catalogue?: readonly SocialPolicyItem[]
  /** The viewer's own chosen policies (`view.you.socialPolicies`). */
  readonly policiesChosen?: readonly SocialPolicyItem[]
  readonly spectator?: boolean
}

function renderPanel({
  techsChosen = [],
  civilization = null,
  revealed = [],
  catalogue = [],
  policiesChosen = [],
  spectator = false,
}: PanelOptions = {}): HTMLElement {
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  vi.spyOn(api, 'revealedTechs').mockResolvedValue([...revealed])
  vi.spyOn(api, 'socialPolicies').mockResolvedValue([...catalogue])
  const { container } = render(
    <TechPanel
      gameId="game-1"
      busy={false}
      run={run}
      view={spectator ? spectatorView() : view(techsChosen, civilization, policiesChosen)}
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

/** A social policy as the deck catalogue serves it (issue #101). */
const policy = (name: string, flipside: string | null): SocialPolicyItem => ({
  id: `policy-${name}`,
  name,
  flipside,
  description: `${name} card text`,
  hidden: false,
  itemNumber: 1,
  used: false,
  ownerId: null,
  sheetName: 'SOCIAL_POLICY',
  kind: 'socialpolicy',
  type: null,
})

/**
 * The real-data shape, including the one-way `Military Tradition` → `Patronage`
 * flipside that makes the engine's check directional rather than symmetric.
 */
const CATALOGUE: readonly SocialPolicyItem[] = [
  policy('Rationalism', 'Patronage'),
  policy('Patronage', 'Rationalism'),
  policy('Military Tradition', 'Patronage'),
  policy('Pacifism', 'Military Tradition'),
]

describe('TechPanel social policy reference', () => {
  it('opens a reference with every policy, its picture, text and flipside', async () => {
    renderPanel({ catalogue: CATALOGUE })
    await screen.findByRole('option', { name: 'Rationalism' })

    fireEvent.click(screen.getByRole('button', { name: 'Show social policy card reference' }))

    expect(document.querySelectorAll('.reference-card')).toHaveLength(CATALOGUE.length)
    for (const card of CATALOGUE) {
      const heading = screen.getByRole('heading', { name: card.name })
      const article = heading.closest('.reference-card')
      expect(article).not.toBeNull()
      expect(article?.querySelector('img')?.getAttribute('src')).toBe(itemImageUrl(card))
      expect(article?.textContent).toContain(`${card.name} card text`)
      expect(article?.textContent).toContain(`Flipside: ${card.flipside}`)
    }
  })

  it('shows the same reference to a spectator with no chosen policies', async () => {
    renderPanel({ spectator: true, catalogue: CATALOGUE })
    await screen.findByRole('option', { name: 'Rationalism' })

    fireEvent.click(screen.getByRole('button', { name: 'Show social policy card reference' }))

    expect(document.querySelectorAll('.reference-card')).toHaveLength(CATALOGUE.length)
  })

  it('closes on Escape and returns focus to the ? button', () => {
    renderPanel({ catalogue: CATALOGUE })
    const help = screen.getByRole('button', { name: 'Show social policy card reference' })

    fireEvent.click(help)
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(help)
  })
})

describe('TechPanel social policy availability', () => {
  it('greys out the chosen policy and one whose flipside is chosen, naming the reason', async () => {
    renderPanel({ catalogue: CATALOGUE, policiesChosen: [policy('Rationalism', 'Patronage')] })
    await screen.findByRole('option', { name: 'Rationalism — already chosen' })

    const select = screen.getByRole('combobox', {
      name: 'Choose a social policy',
    }) as HTMLSelectElement
    expect([...select.options].map((option) => [option.textContent, option.disabled])).toEqual([
      ['choose a card …', false],
      ['Rationalism — already chosen', true],
      ['Patronage — flipside of Rationalism', true],
      ['Military Tradition', false],
      ['Pacifism', false],
    ])
    const message = screen.getByRole('status').textContent ?? ''
    expect(message).toContain('Rationalism (already chosen)')
    expect(message).toContain('Patronage (flipside of Rationalism)')
  })

  it('mirrors the engine: the flipside check is directional, so Patronage stays selectable', async () => {
    renderPanel({
      catalogue: CATALOGUE,
      policiesChosen: [policy('Military Tradition', 'Patronage')],
    })
    await screen.findByRole('option', { name: 'Military Tradition — already chosen' })

    const select = screen.getByRole('combobox', {
      name: 'Choose a social policy',
    }) as HTMLSelectElement
    const byLabel = new Map([...select.options].map((option) => [option.textContent, option.disabled]))
    expect(byLabel.get('Military Tradition — already chosen')).toBe(true)
    expect(byLabel.get('Pacifism — flipside of Military Tradition')).toBe(true)
    // A symmetric rule would block this; the engine, and therefore the panel,
    // does not.
    expect(byLabel.get('Patronage')).toBe(false)
  })

  it('chooses an available policy through the shared runner', async () => {
    const choose = vi.spyOn(api, 'chooseSocialPolicy').mockResolvedValue(view([], null))
    renderPanel({ catalogue: CATALOGUE })
    await screen.findByRole('option', { name: 'Rationalism' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a social policy' }), {
      target: { value: 'Rationalism' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))

    await waitFor(() => expect(choose).toHaveBeenCalledWith('game-1', 'Rationalism'))
  })
})
