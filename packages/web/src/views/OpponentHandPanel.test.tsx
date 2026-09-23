// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { OpaquePlayerhand, PublicHandCounts } from '@civ/engine'

import { OpponentHandPanel } from './OpponentHandPanel.js'

afterEach(cleanup)

function opponent(playerId: string, username: string, publicHand: PublicHandCounts): OpaquePlayerhand {
  return { playerId, username, publicHand } as OpaquePlayerhand
}

describe('OpponentHandPanel', () => {
  it('shows one generic face-down card per item, grouped by player and category', () => {
    render(<OpponentHandPanel opponents={[
      opponent('one', 'Alice', { cultureCards: 2, huts: 1, villages: 0, greatPersons: 1, units: 3 }),
      opponent('two', 'Bob', { cultureCards: 0, huts: 0, villages: 2, greatPersons: 0, units: 1 }),
    ]} />)

    const alice = screen.getByRole('region', { name: "Alice's hand" })
    const bob = screen.getByRole('region', { name: "Bob's hand" })
    expect(within(alice).getAllByRole('listitem')).toHaveLength(7)
    expect(within(alice).getByRole('list', { name: 'Culture cards' }).children).toHaveLength(2)
    expect(within(bob).getAllByRole('listitem')).toHaveLength(3)
    expect(within(bob).getByRole('list', { name: 'Villages' }).children).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /discard|reveal|trade/i })).toBeNull()
    expect(document.querySelector('.opponent-hand img')).toBeNull()
  })

  it('updates from the selected view and never renders private item fields', () => {
    const { rerender } = render(<OpponentHandPanel opponents={[
      opponent('one', 'Alice', { cultureCards: 1, huts: 0, villages: 0, greatPersons: 0, units: 0 }),
    ]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    rerender(<OpponentHandPanel opponents={[
      opponent('one', 'Alice', { cultureCards: 0, huts: 1, villages: 1, greatPersons: 0, units: 0 }),
    ]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('heading', { name: 'Culture cards (1)' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Villages (1)' })).toBeTruthy()
    expect(document.querySelector('.opponent-hand img')).toBeNull()
  })
})
