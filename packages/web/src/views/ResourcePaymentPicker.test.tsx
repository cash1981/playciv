// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistedActionKind, PlayerView, ResourcePaymentOption } from '@civ/engine'

import { api } from '../lib/api.js'
import { AssistedActionButton, resetPendingRequestIds } from './AssistedActions.js'
import { paymentKey, resourcePaymentSelection } from './ResourcePaymentPicker.js'
import type { ResourcePayment } from './ResourcePaymentPicker.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetPendingRequestIds()
})

const token = (resource: string, id = resource, kind: 'hut' | 'piece' = 'hut'): ResourcePaymentOption => ({
  choice: { resource, id, kind },
  label: `${resource} (${kind === 'hut' ? 'hand' : 'player area'})`,
})
const gift = (resource: string): ResourcePaymentOption => ({
  choice: { resource, id: 'gift', kind: 'card' },
  label: `A Generous Gift (as ${resource})`,
})
const viewOf = (action: AssistedActionKind, payment: ResourcePayment): PlayerView => ({
  rev: 7,
  you: {
    playerId: 'me',
    availableActions: [{ action, label: action, status: 'ready', reason: 'Ready to use.', payment }],
  },
  opponents: [],
} as unknown as PlayerView)

const run = async (call: () => Promise<unknown>) => { await call() }
const button = (view: PlayerView, action: AssistedActionKind = 'pottery') =>
  <AssistedActionButton action={action} gameId="game" view={view} busy={false} readOnly={false} run={run} />

function choose(index: number, option: ResourcePaymentOption) {
  fireEvent.change(screen.getByLabelText(`Resource ${index}`), { target: { value: paymentKey(option.choice) } })
}

describe('shared resource-payment choices', () => {
  it('offers only projected payments, explicitly plays a Gift instead of a held token, and does not reuse the card', () => {
    const wheat = token('Wheat')
    const silk = token('Silk', 'silk-piece', 'piece')
    const card = gift('Iron')
    const payment = { cost: [null, null], options: [wheat, silk, card, gift('Wheat'), gift('Spy')] }
    const view = viewOf('pottery', payment)
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
    render(button(view))
    fireEvent.click(screen.getByRole('button', { name: 'Use pottery' }))

    expect(screen.queryByRole('option', { name: /^Uranium/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /^Iron \(/ })).toBeNull()
    expect(within(screen.getByLabelText('Resource 1')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Wheat (hand)', 'Silk (player area)', 'A Generous Gift (as Iron)'])

    choose(1, card)
    expect(screen.getAllByLabelText(/^Resource \d$/).map((select) => (select as HTMLSelectElement).value))
      .toEqual([paymentKey(card.choice), paymentKey(silk.choice)])
    choose(2, wheat)
    fireEvent.click(screen.getByRole('button', { name: 'Pay A Generous Gift (as Iron) and Wheat (hand)' }))
    expect(send.mock.calls[0]?.[4]).toEqual({
      resources: ['Iron', 'Wheat'],
      payments: [card.choice, wheat.choice],
    })
  })

  it('pays two copies of a resource and one Gift using three distinct sources', () => {
    const payment = { cost: [null, null, null], options: [token('Wheat', 'w1'), token('Wheat', 'w2', 'piece'), gift('Iron'), gift('Silk')] }
    const selected = resourcePaymentSelection(payment)
    expect(selected.map((option) => option.choice.id)).toEqual(['w1', 'w2', 'gift'])
    const switched = resourcePaymentSelection(payment, selected.map((option) => option.choice), { index: 0, key: paymentKey(gift('Iron').choice) })
    expect(switched.map((option) => option.choice.id)).toEqual(['gift', 'w2', 'w1'])
    expect(resourcePaymentSelection({ ...payment, cost: [null, null, null, null] })).toEqual([])
  })

  it('sends a hand village as its own payment kind without counting its icon as another resource', () => {
    const village: ResourcePaymentOption = {
      choice: { kind: 'village', id: 'village-iron', resource: 'Iron' },
      label: 'Iron (village in hand)',
    }
    const wheat = token('Wheat')
    const payment = { cost: [null, null], options: [wheat, village] }
    const view = viewOf('pottery', payment)
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
    render(button(view))
    fireEvent.click(screen.getByRole('button', { name: 'Use pottery' }))

    expect(within(screen.getByLabelText('Resource 2')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Wheat (hand)', 'Iron (village in hand)'])
    fireEvent.click(screen.getByRole('button', { name: 'Pay Wheat (hand) and Iron (village in hand)' }))
    expect(send.mock.calls[0]?.[4]).toEqual({
      resources: ['Wheat', 'Iron'],
      payments: [wheat.choice, village.choice],
    })
    expect(resourcePaymentSelection({ ...payment, cost: [null, null, null] })).toEqual([])
  })

  it('does not offer a fixed-cost card allocation that leaves another required resource unpaid', () => {
    const payment = { cost: ['Incense', 'Iron', 'Silk', 'Wheat'], options: [token('Incense'), token('Iron'), token('Silk'), gift('Iron'), gift('Wheat')] }
    const view = viewOf('education', payment)
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
    render(button(view, 'education'))
    fireEvent.click(screen.getByRole('button', { name: 'Use education' }))
    expect(within(screen.getByLabelText('Resource 2')).queryByRole('option', { name: /Generous Gift/ })).toBeNull()
    expect(within(screen.getByLabelText('Resource 4')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['A Generous Gift (as Wheat)'])
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    expect(send.mock.calls[0]?.[4]).toEqual({ payments: [
      token('Incense').choice, token('Iron').choice, token('Silk').choice, gift('Wheat').choice,
    ] })
  })

  it('disables a stale explicit payment instead of silently consuming another token or card', () => {
    const wheat = token('Wheat')
    const silk = token('Silk')
    const card = gift('Iron')
    const payment = { cost: [null, null], options: [wheat, silk, card] }
    const before = viewOf('pottery', payment)
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(before)
    const { rerender } = render(button(before))
    fireEvent.click(screen.getByRole('button', { name: 'Use pottery' }))
    choose(1, card)
    rerender(button(viewOf('pottery', { ...payment, options: [wheat, silk] })))

    const pay = screen.getByRole('button', { name: /^Pay/ }) as HTMLButtonElement
    expect(pay.disabled).toBe(true)
    fireEvent.click(pay)
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('payment is no longer available')
    choose(1, wheat)
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    expect(send.mock.calls[0]?.[4]).toEqual({ resources: ['Wheat', 'Silk'], payments: [wheat.choice, silk.choice] })
  })

  it.each(['currency', 'chivalry', 'metalCasting', 'mathematics', 'ballistics'] as const)(
    '%s uses the shared selector even without a technology-specific target picker',
    (action) => {
      const option = token('Incense')
      const view = viewOf(action, { cost: ['Incense'], options: [option] })
      const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
      const automatic = vi.spyOn(api, 'performAction').mockResolvedValue(view)
      render(button(view, action))
      fireEvent.click(screen.getByRole('button', { name: `Use ${action}` }))
      expect(send).not.toHaveBeenCalled()
      expect(automatic).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Pay Incense (hand)' }))
      expect(send.mock.calls[0]?.[4]).toEqual({ payments: [option.choice] })
    },
  )

  it.each(['animalHusbandry', 'construction', 'banking', 'plastics'] as const)(
    '%s sends its city and the explicitly selected culture card together',
    (action) => {
      const card = gift('Wheat')
      const base = viewOf(action, { cost: ['Wheat'], options: [token('Wheat'), card] })
      const view: PlayerView = { ...base, you: { ...base.you!, cities: [{
        pieceId: 'capital', label: 'Capital B2', estimate: 5, outskirts: 5,
        outskirtsDetail: [], modifiers: [], buildingProgram: false, caravan: false,
        boost: 0, withBuildingProgram: null, override: null, effective: 5, notes: [],
        trade: { outskirts: 0, detail: [], notes: [] },
      }] } }
      const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
      render(button(view, action))
      fireEvent.click(screen.getByRole('button', { name: `Use ${action}` }))
      choose(1, card)
      fireEvent.click(screen.getByRole('button', { name: 'Boost Capital B2' }))
      expect(send.mock.calls[0]?.[4]).toEqual({ cityPieceId: 'capital', payments: [card.choice] })
    },
  )

  it('uses the Curie substitute at most once without counting a physical token twice', () => {
    const wheat = token('Wheat')
    const uranium = { ...wheat, choice: { ...wheat.choice, resource: 'Uranium' }, usesCurie: true }
    const second = { ...uranium, choice: { ...uranium.choice, id: 'second-wheat' } }
    expect(resourcePaymentSelection({ cost: ['Uranium', 'Uranium'], options: [uranium, second] })).toEqual([])
    expect(resourcePaymentSelection({ cost: [null, null], options: [wheat, uranium] })).toEqual([])
  })
})
