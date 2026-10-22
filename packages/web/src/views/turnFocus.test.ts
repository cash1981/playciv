import { describe, expect, it } from 'vitest'

import type { TurnPhase } from '@civ/engine'

import type { ActiveTurnStatus } from '../lib/api.js'
import { earliestOthers, focusPlayer } from './turnFocus.js'

const turn = (
  holder: string,
  waitingFor: readonly { readonly username: string; readonly phase: TurnPhase }[],
): ActiveTurnStatus =>
  ({ playerId: `id-${holder}`, username: holder, turnNumber: 1, phase: 'SOT', startPlayer: holder, waitingFor }) as ActiveTurnStatus

describe('focusPlayer', () => {
  it('is the viewer when the viewer is behind the others', () => {
    const active = turn('admin', [
      { username: 'admin', phase: 'MOVEMENT' },
      { username: 'cash', phase: 'CM' },
    ])
    expect(focusPlayer(active, 'cash')).toEqual({ username: 'cash', phase: 'CM' })
  })

  it('is the player furthest behind when the viewer is ahead', () => {
    const active = turn('cash', [
      { username: 'admin', phase: 'CM' },
      { username: 'cash', phase: 'MOVEMENT' },
    ])
    expect(focusPlayer(active, 'cash')).toEqual({ username: 'admin', phase: 'CM' })
  })

  it('prefers the viewer in a tie', () => {
    const active = turn('admin', [
      { username: 'admin', phase: 'TRADE' },
      { username: 'cash', phase: 'TRADE' },
    ])
    expect(focusPlayer(active, 'cash')?.username).toBe('cash')
  })

  it('prefers the turn holder in a tie that does not include the viewer', () => {
    const active = turn('carol', [
      { username: 'bob', phase: 'TRADE' },
      { username: 'carol', phase: 'TRADE' },
      { username: 'viewer', phase: 'MOVEMENT' },
    ])
    expect(focusPlayer(active, 'viewer')?.username).toBe('carol')
  })

  it('picks the first in the list in a tie without the viewer or the holder', () => {
    const active = turn('holder', [
      { username: 'bob', phase: 'TRADE' },
      { username: 'carol', phase: 'TRADE' },
      { username: 'holder', phase: 'RESEARCH' },
    ])
    expect(focusPlayer(active, 'viewer')?.username).toBe('bob')
    expect(focusPlayer(active)?.username).toBe('bob')
  })

  it('is nobody when everyone is done or there is no active turn', () => {
    expect(focusPlayer(turn('admin', []), 'cash')).toBeNull()
    expect(focusPlayer(null, 'cash')).toBeNull()
  })
})

describe('earliestOthers', () => {
  it('lists the others at the earliest phase and not the ones ahead', () => {
    const active = turn('cash', [
      { username: 'cash', phase: 'MOVEMENT' },
      { username: 'admin', phase: 'CM' },
      { username: 'carol', phase: 'CM' },
      { username: 'dave', phase: 'RESEARCH' },
    ])
    expect(earliestOthers(active, 'cash')).toEqual({ phase: 'CM', usernames: ['admin', 'carol'] })
  })

  it('is null when the viewer is alone at the earliest phase', () => {
    const active = turn('admin', [
      { username: 'admin', phase: 'MOVEMENT' },
      { username: 'cash', phase: 'CM' },
    ])
    expect(earliestOthers(active, 'cash')).toBeNull()
  })

  it('leaves the viewer out of a tie but still lists the others', () => {
    const active = turn('admin', [
      { username: 'cash', phase: 'CM' },
      { username: 'admin', phase: 'CM' },
    ])
    expect(earliestOthers(active, 'cash')).toEqual({ phase: 'CM', usernames: ['admin'] })
  })

  it('lists everyone at the earliest phase for a viewer who is done or a spectator', () => {
    const active = turn('admin', [{ username: 'admin', phase: 'TRADE' }])
    expect(earliestOthers(active, 'cash')).toEqual({ phase: 'TRADE', usernames: ['admin'] })
    expect(earliestOthers(active)).toEqual({ phase: 'TRADE', usernames: ['admin'] })
  })

  it('is null when everyone is done or there is no active turn', () => {
    expect(earliestOthers(turn('admin', []), 'cash')).toBeNull()
    expect(earliestOthers(null, 'cash')).toBeNull()
  })
})
