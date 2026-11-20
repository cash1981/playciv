// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const romanVillage: Offer = { id: 'offer-1', kind: 'village', square: 'B4', civ: 'Romans', blocked: null, nothing: null, villageGone: false }
const chineseVillage: Offer = { id: 'offer-2', kind: 'village', square: 'C2', civ: 'Chinese', blocked: null, nothing: null, villageGone: false }
const romanCity: Offer = { id: 'offer-3', kind: 'city', square: 'D4', civ: 'Romans', blocked: null, nothing: null, villageGone: false }
const japaneseVillage: Offer = { id: 'offer-4', kind: 'village', square: 'E5', civ: 'Japanese', blocked: null, nothing: null, villageGone: false }

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
      screen.getByText(
        'You conquered the village on B4. Take it: its token goes to your area and its card into your hand. As the Romans you may also advance one space on the culture track.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take village and advance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeTruthy()
  })

  it('asks the Chinese about 3 culture, and the Romans about a city as a city', () => {
    renderPrompt(viewWith([chineseVillage, romanCity]))
    expect(
      screen.getByText('You conquered the village on C2. Take it: its token goes to your area and its card into your hand. As the Chinese you also gain 3 culture.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take village and 3 culture' })).toBeTruthy()
    expect(
      screen.getByText('You conquered the city on D4. As the Romans you may advance one space on the culture track.'),
    ).toBeTruthy()
    // One pair of answers for each offer
    expect(screen.getAllByRole('button', { name: 'No thanks' })).toHaveLength(2)
  })

  it('sends one claim to accept, with the offer and the revision the viewer saw', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderPrompt(viewWith([romanVillage], 9))
    fireEvent.click(screen.getByRole('button', { name: 'Take village and advance' }))
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
    const accept = screen.getByRole('button', { name: 'Take village and 3 culture' })
    fireEvent.click(accept)
    fireEvent.click(accept)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    finish({} as PlayerView)
  })

  it('shows why a Roman advance is stopped, keeps it from being pressed and still lets the player say no', () => {
    const stopped: Offer = { ...romanVillage, blocked: 'Choose the card to keep from your last advance first.' }
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderPrompt(viewWith([stopped]))
    const advance = screen.getByRole('button', { name: 'Take village and advance' }) as HTMLButtonElement
    expect(advance.disabled).toBe(true)
    expect(screen.getByText('Not now: Choose the card to keep from your last advance first.')).toBeTruthy()
    fireEvent.click(advance)
    expect(send).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'No thanks' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('hands a refusal to the page once, and does not write it on the offer as well', async () => {
    const refusal = new ApiError(400, 'ASSISTED_ACTION_REJECTED', 'That conquest offer is not open.')
    vi.spyOn(api, 'actionWithArgs').mockRejectedValue(refusal)
    const caught: unknown[] = []
    const reporting: Run = async (action) => {
      try {
        await action()
      } catch (error) {
        caught.push(error)
      }
    }
    render(<ConquestPrompt gameId="game-1" view={viewWith([chineseVillage])} busy={false} readOnly={false} run={reporting} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take village and 3 culture' }))
    await waitFor(() => expect(caught).toEqual([refusal]))
    // The page shows the error (GameView's `run`); the prompt adds no second copy of it
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/not open/)).toBeNull()
  })

  it('says before the press that a Roman advance has nothing to move, and that accepting only closes the offer', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const nothing: Offer = { ...romanVillage, nothing: 'Your marker is already on the Culture Victory space.' }
    renderPrompt(viewWith([nothing]))
    expect(
      screen.getByText('Nothing to advance: your marker is already on the Culture Victory space. Accepting still takes the village.'),
    ).toBeTruthy()
    cleanup()
    renderPrompt(viewWith([{ ...nothing, villageGone: true }]))
    expect(screen.getByText(/Accepting only closes this\./)).toBeTruthy()
    cleanup()
    renderPrompt(viewWith([nothing]))
    // It can still be answered: accepting closes the offer
    const advance = screen.getByRole('button', { name: 'Take village and advance' }) as HTMLButtonElement
    expect(advance.disabled).toBe(false)
    fireEvent.click(advance)
    await waitFor(() => expect(send).toHaveBeenCalledWith('game-1', 'claimConquest', expect.any(String), 7, { offerId: 'offer-1', accept: true }))
  })

  it('offers a civ without an extra just the village, in words and on the button', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderPrompt(viewWith([japaneseVillage]))
    expect(
      screen.getByText('You conquered the village on E5. Take it: its token goes to your area and its card into your hand.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Take the village' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('game-1', 'claimConquest', expect.any(String), 7, { offerId: 'offer-4', accept: true }))
    expect(screen.queryByText(/As the/)).toBeNull()
  })

  it('says that the village token is gone from the square, and offers only the extra the civ has', () => {
    renderPrompt(
      viewWith([
        { ...romanVillage, villageGone: true },
        { ...chineseVillage, villageGone: true },
        { ...japaneseVillage, villageGone: true },
      ]),
    )
    expect(
      screen.getByText('You conquered the village on B4, but its token is no longer on the map. As the Romans you may advance one space on the culture track.'),
    ).toBeTruthy()
    expect(screen.getByText('You conquered the village on C2, but its token is no longer on the map. As the Chinese you gain 3 culture.')).toBeTruthy()
    expect(screen.getByText('You conquered the village on E5, but its token is no longer on the map. There is nothing to take.')).toBeTruthy()
    for (const name of ['Advance', 'Take 3 culture', 'Close']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })

  it('has no such note for an advance that can be made, or for the Chinese', () => {
    renderPrompt(viewWith([romanVillage, chineseVillage]))
    expect(screen.queryByText(/Nothing to advance/)).toBeNull()
    expect(screen.queryByText(/Not now/)).toBeNull()
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
      for (const name of ['Take village and 3 culture', 'No thanks']) {
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
    const prompt = screen.getByRole('region', { name: 'Conquest' })
    const tabs = screen.getByRole('tablist', { name: 'Phases of the turn' })
    // The prompt comes before the tabs in the document
    expect(prompt.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^Research/ }))
    expect(screen.getByRole('region', { name: 'Conquest' })).toBeTruthy()
  })

  it('counts one offer as one choice, and leaves the title alone without one', () => {
    renderActions(viewWith([romanVillage]))
    expect(screen.getByRole('heading', { name: 'Your actions (1 choice waiting)' })).toBeTruthy()
    cleanup()
    renderActions(viewWith([]))
    expect(screen.getByRole('heading', { name: 'Your actions' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Conquest' })).toBeNull()
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

describe('the Chinese save in Your actions', () => {
  const units = [{ arenaUnitId: 'a1', name: 'Infantry 1.3', position: 0 }]
  const withSave = (chineseSave: unknown): PlayerView => {
    const base = viewWith([])
    return { ...base, you: { ...base.you, chineseSave } } as unknown as PlayerView
  }

  it('is above the phase tabs as one waiting choice, saves the chosen unit, and puts the panel on the page on its own', async () => {
    const saved = vi.spyOn(api, 'chineseSave').mockResolvedValue(viewWith([]))
    render(<PhaseActionsPanel gameId="g1" view={withSave({ units })} busy={false} readOnly={false} run={run} />)
    expect(screen.getByRole('heading', { name: 'Your actions (1 choice waiting)' })).toBeTruthy()
    const prompt = screen.getByRole('region', { name: 'Chinese save' })
    const tabs = screen.getByRole('tablist', { name: 'Phases of the turn' })
    expect(prompt.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Killed unit to save' }), { target: { value: 'a1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save unit' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith('g1', 'a1', 7))

    const only = { rev: 1, you: { playerId: 'me', cities: [], availableActions: [], pendingRewards: [], conquestOffers: [], chineseSave: { units } }, opponents: [] } as unknown as PlayerView
    expect(hasActionsPanel(only)).toBe(true)
    expect(hasActionsPanel({ ...only, you: { ...only.you, chineseSave: null } } as unknown as PlayerView)).toBe(false)
  })

  it('is not there, and counts no choice, without a save to make', () => {
    render(<PhaseActionsPanel gameId="g1" view={withSave(null)} busy={false} readOnly={false} run={run} />)
    expect(screen.getByRole('heading', { name: 'Your actions' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Chinese save' })).toBeNull()
  })
})
