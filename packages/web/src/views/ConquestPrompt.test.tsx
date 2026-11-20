// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { hasActionsPanel, resetPendingRequestIds } from './AssistedActions.js'
import { ConquestPrompt } from './ConquestPrompt.js'
import type { Run } from './GameView.js'
import { PhaseActionsPanel } from './PhaseTabs.js'

beforeEach(() => {
  localStorage.setItem('civ.panel.actions', 'true')
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.actions')
  vi.restoreAllMocks()
})

type Offer = NonNullable<PlayerView['you']>['conquestOffers'][number]

const romanVillage: Offer = { id: 'offer-1', kind: 'village', square: 'B4', civ: 'Romans', blocked: null }
const chineseVillage: Offer = { id: 'offer-2', kind: 'village', square: 'C2', civ: 'Chinese', blocked: null }
const romanCity: Offer = { id: 'offer-3', kind: 'city', square: 'D4', civ: 'Romans', blocked: null }

const viewWith = (offers: readonly Offer[], rev = 7): PlayerView =>
  ({
    rev,
    you: {
      playerId: 'me',
      username: 'Alice',
      cities: [],
      stats: { trade: 0 },
      availableActions: [],
      pendingRewards: [],
      conquestOffers: offers,
      techsChosen: [],
      pyramidPlacements: [],
    },
    activeTurn: { turnNumber: 3, waitingFor: [{ username: 'Alice', phase: 'MOVEMENT' }] },
    opponents: [],
  }) as unknown as PlayerView

// GameView's run reports a failure on screen instead of throwing; so does this.
const run: Run = async (action) => {
  try {
    await action()
  } catch {
    /* shown by GameView in the real app */
  }
}

const renderPrompt = (view: PlayerView, props: { busy?: boolean; readOnly?: boolean } = {}) =>
  render(<ConquestPrompt gameId="game-1" view={view} busy={props.busy ?? false} readOnly={props.readOnly ?? false} run={run} />)

describe('the conquest prompt', () => {
  it('asks the Romans about a village in words, with Advance and No thanks', () => {
    renderPrompt(viewWith([romanVillage]))
    expect(
      screen.getByText('You conquered the village on B4. As the Romans you may advance one space on the culture track.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Advance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeTruthy()
  })

  it('asks the Chinese about 3 culture, and the Romans about a city as a city', () => {
    renderPrompt(viewWith([chineseVillage, romanCity]))
    expect(screen.getByText('You conquered the village on C2. As the Chinese you gain 3 culture.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take 3 culture' })).toBeTruthy()
    expect(
      screen.getByText('You conquered the city on D4. As the Romans you may advance one space on the culture track.'),
    ).toBeTruthy()
    // One pair of answers for each offer
    expect(screen.getAllByRole('button', { name: 'No thanks' })).toHaveLength(2)
  })

  it('sends one claim to accept, with the offer and the revision the viewer saw', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderPrompt(viewWith([romanVillage], 9))
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('game-1', 'claimConquest', expect.any(String), 9, { offerId: 'offer-1', accept: true })
  })

  it('sends accept false for No thanks, and nothing for either answer before a press', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderPrompt(viewWith([chineseVillage]))
    expect(send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('game-1', 'claimConquest', expect.any(String), 7, { offerId: 'offer-2', accept: false })
  })

  it('keeps one request for a double press and a new one after the server answered', async () => {
    let finish: (view: PlayerView) => void = () => undefined
    const send = vi.spyOn(api, 'actionWithArgs').mockReturnValue(new Promise<PlayerView>((resolve) => { finish = resolve }))
    renderPrompt(viewWith([chineseVillage]))
    const accept = screen.getByRole('button', { name: 'Take 3 culture' })
    fireEvent.click(accept)
    fireEvent.click(accept)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    finish({} as PlayerView)
  })

  it('shows why a Roman advance is stopped, keeps it from being pressed and still lets the player say no', () => {
    const stopped: Offer = { ...romanVillage, blocked: 'Choose the card to keep from your last advance first.' }
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderPrompt(viewWith([stopped]))
    const advance = screen.getByRole('button', { name: 'Advance' }) as HTMLButtonElement
    expect(advance.disabled).toBe(true)
    expect(screen.getByText('Not now: Choose the card to keep from your last advance first.')).toBeTruthy()
    fireEvent.click(advance)
    expect(send).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'No thanks' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the reason the engine gave when it refuses a press, on the offer it was for', async () => {
    vi.spyOn(api, 'actionWithArgs').mockRejectedValue(
      new ApiError(400, 'ASSISTED_ACTION_REJECTED', 'The Romans advance one space for free for a conquest, and that is stopped now: Your hand is over its size.'),
    )
    renderPrompt(viewWith([romanVillage, chineseVillage]))
    fireEvent.click(screen.getAllByRole('button', { name: 'No thanks' })[0] as HTMLElement)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stopped now: Your hand is over its size.')
    // The reason sits with the first offer, not the second
    const offers = document.querySelectorAll('.assisted-conquest-offer')
    expect(within(offers[0] as HTMLElement).getByRole('alert')).toBe(alert)
    expect(within(offers[1] as HTMLElement).queryByRole('alert')).toBeNull()
  })

  it('shows nothing without an offer, for a spectator, or for a viewer whose list is missing', () => {
    expect(renderPrompt(viewWith([])).container.firstChild).toBeNull()
    cleanup()
    expect(renderPrompt({ rev: 1, you: null, opponents: [] } as unknown as PlayerView).container.firstChild).toBeNull()
    cleanup()
    const noList = { rev: 1, you: { playerId: 'me' }, opponents: [] } as unknown as PlayerView
    expect(renderPrompt(noList).container.firstChild).toBeNull()
  })

  it('disables both answers while busy and for a viewer who cannot act (a replay, a locked game)', () => {
    for (const props of [{ busy: true }, { readOnly: true }]) {
      cleanup()
      renderPrompt(viewWith([chineseVillage]), props)
      for (const name of ['Take 3 culture', 'No thanks']) {
        expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, `${name} ${JSON.stringify(props)}`).toBe(true)
      }
    }
  })
})

describe('the prompt in Your actions', () => {
  const renderActions = (view: PlayerView) =>
    render(<PhaseActionsPanel gameId="g1" view={view} busy={false} readOnly={false} run={run} />)

  it('is above the phase tabs, whichever tab is open, and the title says a choice is waiting', () => {
    renderActions(viewWith([romanVillage, chineseVillage]))
    expect(screen.getByRole('heading', { name: 'Your actions (2 choices waiting)' })).toBeTruthy()
    const prompt = screen.getByRole('status', { name: 'Conquest' })
    const tabs = screen.getByRole('tablist', { name: 'Phases of the turn' })
    // The prompt comes before the tabs in the document
    expect(prompt.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^Research/ }))
    expect(screen.getByRole('status', { name: 'Conquest' })).toBeTruthy()
  })

  it('counts one offer as one choice, and leaves the title alone without one', () => {
    renderActions(viewWith([romanVillage]))
    expect(screen.getByRole('heading', { name: 'Your actions (1 choice waiting)' })).toBeTruthy()
    cleanup()
    renderActions(viewWith([]))
    expect(screen.getByRole('heading', { name: 'Your actions' })).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Conquest' })).toBeNull()
  })

  it('puts "Your actions" on the page for a viewer whose only reason is an offer', () => {
    const only = {
      rev: 1,
      you: { playerId: 'me', username: 'Alice', cities: [], availableActions: [], pendingRewards: [], conquestOffers: [romanVillage] },
      opponents: [],
    } as unknown as PlayerView
    expect(hasActionsPanel(only)).toBe(true)
    const without = { ...only, you: { ...only.you, conquestOffers: [] } } as unknown as PlayerView
    expect(hasActionsPanel(without)).toBe(false)
  })
})
