// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SocialPolicyItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { itemImageUrl } from './ItemCard.js'
import { SocialPolicyPanel } from './SocialPolicyPanel.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A social policy as the deck catalogue serves it (issue #101). */
const policy = (
  name: string,
  flipside: string | null,
  hidden = false,
): SocialPolicyItem => ({
  id: `policy-${name}`,
  name,
  flipside,
  description: `${name} card text`,
  hidden,
  itemNumber: 1,
  used: false,
  ownerId: hidden ? 'me' : null,
  sheetName: 'SOCIAL_POLICY',
  kind: 'socialpolicy',
  type: null,
})

/**
 * The real `SOCIAL_POLICY` sheet, all eight, including the one-way
 * `Military Tradition` → `Patronage` flipside that makes the engine's check
 * directional rather than symmetric (`Patronage` points back at `Rationalism`).
 */
const CATALOGUE: readonly SocialPolicyItem[] = [
  policy('Rationalism', 'Patronage'),
  policy('Natural Religion', 'Organized Religion'),
  policy('Expansionsim', 'Urban Development'),
  policy('Pacifism', 'Military Tradition'),
  policy('Patronage', 'Rationalism'),
  policy('Organized Religion', 'Natural Religion'),
  policy('Urban Development', 'Expansionsim'),
  policy('Military Tradition', 'Patronage'),
]

/** One opponent exactly as `toPlayerView` sends them: revealed policies only. */
const opponent = (
  playerId: string,
  username: string,
  options: {
    readonly color?: string
    readonly civilization?: string | null
    readonly revealedPolicies?: readonly SocialPolicyItem[]
  } = {},
) => ({
  playerId,
  username,
  color: options.color ?? 'Blue',
  civilization:
    options.civilization === null
      ? null
      : { name: options.civilization ?? `${username}land` },
  revealedSocialPolicies: options.revealedPolicies ?? [],
})

const view = (
  policiesChosen: readonly SocialPolicyItem[],
  opponents: readonly unknown[] = [],
): PlayerView =>
  ({
    you: {
      playerId: 'me',
      username: 'cash1981',
      color: 'Red',
      civilization: { name: 'Rome' },
      socialPolicies: policiesChosen,
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
  /** The fetched catalogue (`api.socialPolicies`), what the reference lists. */
  readonly catalogue?: readonly SocialPolicyItem[]
  /** The viewer's own chosen policies (`view.you.socialPolicies`). */
  readonly policiesChosen?: readonly SocialPolicyItem[]
  readonly opponents?: readonly unknown[]
  readonly spectator?: boolean
}

function renderPanel({
  catalogue = [],
  policiesChosen = [],
  opponents = [],
  spectator = false,
}: PanelOptions = {}): HTMLElement {
  vi.spyOn(api, 'socialPolicies').mockResolvedValue([...catalogue])
  const { container } = render(
    <SocialPolicyPanel
      gameId="game-1"
      busy={false}
      run={run}
      view={spectator ? spectatorView(opponents) : view(policiesChosen, opponents)}
      reloadCount={0}
    />,
  )
  return container
}

function tabNames(): (string | null)[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent)
}

function activePanel(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')
  if (panel === null) throw new Error('the tab panel is not rendered')
  return panel
}

describe('SocialPolicyPanel tabs', () => {
  it('opens on the viewer\'s own tab and shows the cards with their controls', () => {
    const container = renderPanel({
      policiesChosen: [policy('Rationalism', 'Patronage', true), policy('Pacifism', null)],
    })

    expect(tabNames()).toEqual(['cash1981'])
    const panel = activePanel(container)
    expect(panel.querySelectorAll('.card')).toHaveLength(2)
    expect(panel.textContent).toContain('Rationalism')
    expect(panel.textContent).toContain('flipside: Patronage')
    expect(panel.textContent).toContain('hidden')
    expect(panel.textContent).toContain('revealed')
    expect(screen.getAllByRole('button', { name: 'Reveal' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
  })

  it('reveals the viewer\'s own hidden policy through the shared runner', async () => {
    const reveal = vi
      .spyOn(api, 'revealSocialPolicy')
      .mockResolvedValue({} as PlayerView)
    renderPanel({ policiesChosen: [policy('Rationalism', 'Patronage', true)] })

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))

    await waitFor(() => expect(reveal).toHaveBeenCalledWith('game-1', 'Rationalism'))
  })

  it('shows one tab per player and swaps to the revealed cards of another', () => {
    const container = renderPanel({
      policiesChosen: [policy('Rationalism', 'Patronage', true)],
      opponents: [
        opponent('p2', 'Egil', {
          color: 'Blue',
          revealedPolicies: [policy('Organized Religion', 'Natural Religion')],
        }),
        opponent('p3', 'Kari', { color: 'Green' }),
      ],
    })

    expect(tabNames()).toEqual(['cash1981', 'Egil', 'Kari'])
    expect(activePanel(container).textContent).toContain('Rationalism')

    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))

    const panel = activePanel(container)
    expect(panel.textContent).toContain('Organized Religion')
    expect(panel.textContent).toContain('Natural Religion')
    // The viewer's own cards are not stacked below any more (issue #140).
    expect(panel.textContent).not.toContain('Rationalism')
    // Another player's cards are read-only.
    expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('says none chosen on the own tab and none revealed on another player\'s', () => {
    const container = renderPanel({ opponents: [opponent('p2', 'Egil')] })

    expect(activePanel(container).textContent).toContain('None chosen.')

    fireEvent.click(screen.getByRole('tab', { name: 'Egil' }))

    expect(activePanel(container).textContent).toContain('Has not revealed any social policies.')
  })

  it('gives a spectator a tab per player, no own tab, and the reference', async () => {
    renderPanel({
      spectator: true,
      catalogue: CATALOGUE,
      opponents: [opponent('p2', 'Egil'), opponent('p3', 'Kari')],
    })

    expect(tabNames()).toEqual(['Egil', 'Kari'])
    await screen.findByRole('option', { name: 'Rationalism' })

    fireEvent.click(screen.getByRole('button', { name: 'Show social policy card reference' }))

    expect(document.querySelectorAll('.reference-card')).toHaveLength(CATALOGUE.length)
  })
})

describe('SocialPolicyPanel card reference', () => {
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

describe('SocialPolicyPanel availability', () => {
  it('greys out the chosen policy and one whose flipside is chosen, naming the reason', async () => {
    renderPanel({ catalogue: CATALOGUE, policiesChosen: [policy('Rationalism', 'Patronage')] })
    await screen.findByRole('option', { name: 'Rationalism — already chosen' })

    const select = screen.getByRole('combobox', {
      name: 'Choose a social policy',
    }) as HTMLSelectElement
    expect([...select.options].map((option) => [option.textContent, option.disabled])).toEqual([
      ['choose a card …', false],
      ['Rationalism — already chosen', true],
      ['Natural Religion', false],
      ['Expansionsim', false],
      ['Pacifism', false],
      ['Patronage — flipside of Rationalism', true],
      ['Organized Religion', false],
      ['Urban Development', false],
      ['Military Tradition', false],
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
    const choose = vi.spyOn(api, 'chooseSocialPolicy').mockResolvedValue(view([], []))
    renderPanel({ catalogue: CATALOGUE })
    await screen.findByRole('option', { name: 'Rationalism' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a social policy' }), {
      target: { value: 'Rationalism' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))

    await waitFor(() => expect(choose).toHaveBeenCalledWith('game-1', 'Rationalism'))
  })
})
