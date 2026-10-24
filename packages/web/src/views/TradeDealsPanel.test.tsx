// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { PlayerView } from '../lib/api.js'
import { TradeDealsPanel } from './TradeDealsPanel.js'

afterEach(() => cleanup())

const offer = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  senderId: 'a',
  senderUsername: 'Alice',
  recipientIds: ['b'],
  recipientUsernames: ['Bob'],
  open: false,
  responses: [],
  chosenId: null,
  chosenUsername: null,
  terms: `terms of ${id}`,
  turnNumber: 3,
  phase: 'TRADE',
  status: 'pending',
  parentOfferId: null,
  createdAt: null,
  resolvedAt: null,
  logId: id,
  ...overrides,
})

const viewOf = (offers: readonly Record<string, unknown>[], turn = 3, you: unknown = null): PlayerView =>
  ({ rev: 1, you, opponents: [], activeTurn: { turnNumber: turn, waitingFor: [] }, tradeOffers: offers }) as unknown as PlayerView

const renderPanel = (view: PlayerView) =>
  render(<TradeDealsPanel view={view} tabPanelId="deals" labelledBy="chip" />)

describe('the Trade deals panel', () => {
  it('opens on the current turn, with its turn number', () => {
    renderPanel(viewOf([offer('o1', { turnNumber: 2 }), offer('o2')]))
    expect(screen.getByText('Turn 3')).toBeTruthy()
    expect(screen.getByText('terms of o2')).toBeTruthy()
    expect(screen.queryByText('terms of o1')).toBeNull()
  })

  it('is shown to a viewer who is not a player: the deals are public', () => {
    renderPanel(viewOf([offer('o1')], 3, null))
    expect(screen.getByText('terms of o1')).toBeTruthy()
  })

  it('pages back to earlier turns and forward again, and stops at both ends', () => {
    renderPanel(viewOf([offer('o1', { turnNumber: 1 }), offer('o2', { turnNumber: 2 }), offer('o3')]))
    const previous = screen.getByRole('button', { name: 'Previous turn' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Next turn' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.click(previous)
    expect(screen.getByText('Turn 2')).toBeTruthy()
    expect(screen.getByText('terms of o2')).toBeTruthy()
    fireEvent.click(previous)
    expect(screen.getByText('Turn 1')).toBeTruthy()
    expect(screen.getByText('terms of o1')).toBeTruthy()
    expect(previous.disabled).toBe(true)
    fireEvent.click(next)
    fireEvent.click(next)
    expect(screen.getByText('Turn 3')).toBeTruthy()
    expect(next.disabled).toBe(true)
  })

  it('says when a turn had no deals', () => {
    renderPanel(viewOf([offer('o1', { turnNumber: 1 })]))
    expect(screen.getByText('No trade deals in turn 3.')).toBeTruthy()
  })

  it('groups an offer with its counteroffers, and keeps separate deals apart', () => {
    renderPanel(
      viewOf([
        offer('o1', { status: 'countered' }),
        offer('o2', { senderId: 'b', senderUsername: 'Bob', recipientIds: ['a'], recipientUsernames: ['Alice'], parentOfferId: 'o1' }),
        offer('o3', { recipientIds: ['c'], recipientUsernames: ['Chul'] }),
      ]),
    )
    const threads = screen.getAllByRole('region')
    expect(threads).toHaveLength(2)
    expect(within(threads[0]!).getByText('Counteroffer · Bob → Alice')).toBeTruthy()
    expect(within(threads[1]!).getByRole('heading', { name: 'Deal from Alice to Chul' })).toBeTruthy()
  })

  it('names an open deal and a deal to several, with what the recipients said and who was chosen', () => {
    renderPanel(
      viewOf([
        offer('o1', {
          open: true,
          recipientIds: ['b', 'c'],
          recipientUsernames: ['Bob', 'Chul'],
          status: 'accepted',
          chosenId: 'c',
          chosenUsername: 'Chul',
          responses: [
            { playerId: 'b', username: 'Bob', action: 'decline' },
            { playerId: 'c', username: 'Chul', action: 'accept' },
          ],
        }),
      ]),
    )
    expect(screen.getByRole('heading', { name: 'Open deal from Alice' })).toBeTruthy()
    expect(screen.getByText('Bob declined · Chul accepted')).toBeTruthy()
    expect(screen.getByText('Made with Chul')).toBeTruthy()
  })

  it('shows no buttons: deals are answered in the Trade tab', () => {
    renderPanel(viewOf([offer('o1')], 3, { playerId: 'b' }))
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('wires the tab panel to its chip', () => {
    renderPanel(viewOf([]))
    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBe('deals')
    expect(panel.getAttribute('aria-labelledby')).toBe('chip')
  })
})
