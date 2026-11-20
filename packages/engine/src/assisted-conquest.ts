/**
 * Answering a conquest offer (issue #368): the Romans take their free advance on the culture track, the Chinese their 3
 * culture, or the player declines. The offer is made when a battle for a village or a city is won (`conquest.ts`); nothing
 * is ever gained without this answer.
 *
 * The undo (an undo vote on the action's line, as for every assisted action) takes the gain back and opens the offer again,
 * so it can be answered anew.
 */

import { blocked, lastLogId, playerOf, rejected, withPlayerHand } from './assisted-core.js'
import type { AssistedActionDefinition, AssistedPayload, ClaimConquestPayload } from './assisted-core.js'
import { freeAdvanceStatus, performAdvance, reverseAdvanceEffect } from './assisted-culture.js'
import { withConquestOffers } from './conquest.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import type { ConquestOffer, ConquestOfferView, GameState, Playerhand } from './state.js'

/** The Chinese gain this much culture for conquering a village (civilization card). */
export const CHINESE_CONQUEST_CULTURE = 3

const claimPayloadOf = (payload: AssistedPayload | undefined): ClaimConquestPayload | undefined =>
  payload !== undefined && 'offerId' in payload && typeof payload.offerId === 'string' && 'accept' in payload && typeof payload.accept === 'boolean'
    ? { offerId: payload.offerId, accept: payload.accept }
    : undefined

const whatOf = (offer: ConquestOffer): string => `${offer.kind === 'village' ? 'village' : 'city'} on ${offer.square}`

/** What the reward is called in a line: "the free advance" or "the 3 culture". */
const rewardOf = (offer: ConquestOffer): string => (offer.civ === 'Romans' ? 'the free advance' : `the ${CHINESE_CONQUEST_CULTURE} culture`)

/**
 * The viewer's own open offers, each with why taking it is stopped now (a Roman advance cannot be made while a card choice
 * waits or the hand is over its size) and whether there is nothing to advance (accepting then only closes the offer).
 * Nothing for an opponent: the caller passes the viewer's own hand.
 */
export function conquestOfferViewsOf(state: GameState, player: Playerhand): readonly ConquestOfferView[] {
  const own = (state.conquestOffers ?? []).filter((offer) => offer.playerId === player.playerId)
  if (own.length === 0) return []
  const status = freeAdvanceStatus(state, player)
  return own.map(({ playerId: _owner, ...offer }) => ({
    ...offer,
    blocked: offer.civ === 'Romans' && status.kind === 'blocked' ? status.reason : null,
    nothing: offer.civ === 'Romans' && status.kind === 'nothing' ? status.reason : null,
  }))
}

/** The part of a take-back line for culture, as the Aztec and Arab lines say it: the amount really taken, and what is left. */
const tookBackText = (taken: number, gained: number, left: number): string =>
  `${taken === gained ? taken : `${taken} of ${gained}`} (${left}) culture`

export const claimConquest: AssistedActionDefinition = {
  kind: 'claimConquest',
  techName: null,
  label: 'Conquest reward',
  // It answers an offer the viewer already has, as `chooseReward` answers a card choice: not a button of the action list
  button: false,
  usageKey: null,
  phase: 'ANY',
  group: 'Conquest',
  labelOf: (record) => (record.effect.kind === 'conquestClaim' && !record.effect.accepted ? 'Conquest reward declined' : 'Conquest reward'),

  availability(state, playerId) {
    if (playerOf(state, playerId) === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (!(state.conquestOffers ?? []).some((offer) => offer.playerId === playerId)) {
      return blocked('unavailable', 'You have no conquest to answer.')
    }
    return { status: 'ready', reason: 'Take the reward for your conquest, or decline it.' }
  },

  apply(state, player, context) {
    const fail = (reason: string) => err(rejected('claimConquest', blocked('unavailable', reason)))
    const payload = claimPayloadOf(context.payload)
    if (payload === undefined) return fail('Choose the conquest offer and whether to take it.')
    const offer = (state.conquestOffers ?? []).find((candidate) => candidate.id === payload.offerId)
    if (offer === undefined) return fail('That conquest offer is not open.')
    if (offer.playerId !== player.playerId) return fail('That conquest offer is not yours.')

    const open = withConquestOffers(state, (state.conquestOffers ?? []).filter((candidate) => candidate.id !== offer.id))
    const announce = (base: GameState, text: string): GameState =>
      appendLog(base, {
        username: player.username,
        playerId: player.playerId,
        publicLog: text,
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })

    if (!payload.accept) {
      const logged = announce(open, `${player.username} declined ${rewardOf(offer)} for conquering the ${whatOf(offer)} as the ${offer.civ}`)
      return ok({
        state: logged,
        effect: { kind: 'conquestClaim', offer, accepted: false, culture: 0, advance: null },
        logId: lastLogId(logged),
      })
    }

    if (offer.civ === 'Chinese') {
      const culture = CHINESE_CONQUEST_CULTURE
      const total = player.stats.culture + culture
      const gained = withPlayerHand(open, { ...player, stats: { ...player.stats, culture: total } })
      const logged = announce(gained, `${player.username} gained ${culture} (${total}) culture for conquering the ${whatOf(offer)} as the Chinese`)
      return ok({
        state: logged,
        effect: { kind: 'conquestClaim', offer, accepted: true, culture, advance: null },
        logId: lastLogId(logged),
      })
    }

    // The Romans: one space on the culture track for free, as with every city they found
    const status = freeAdvanceStatus(open, player)
    if (status.kind === 'blocked') {
      return fail(`The Romans advance one space for free for a conquest, and that is stopped now: ${status.reason}`)
    }
    if (status.kind === 'nothing') {
      // At the end of the track there is nothing to advance to and nothing is lost: the offer is closed and logged
      const why = status.reason.charAt(0).toLowerCase() + status.reason.slice(1)
      const logged = announce(open, `${player.username} took the free advance for conquering the ${whatOf(offer)} as the Romans, but there is nothing to advance: ${why}`)
      return ok({
        state: logged,
        effect: { kind: 'conquestClaim', offer, accepted: true, culture: 0, advance: null },
        logId: lastLogId(logged),
      })
    }
    const logged = announce(open, `${player.username} took the free advance for conquering the ${whatOf(offer)} as the Romans`)
    const logId = lastLogId(logged)
    const advanced = performAdvance(logged, playerOf(logged, player.playerId) ?? player, { requestId: context.requestId, at: context.at }, { free: true, tagLog: false })
    if (!advanced.ok) return advanced
    return ok({
      state: advanced.value.state,
      effect: { kind: 'conquestClaim', offer, accepted: true, culture: 0, advance: advanced.value.effect },
      logId,
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'conquestClaim') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    let working = state
    const notes: string[] = []
    // The advance goes first: it can refuse (the marker has moved on, or a card choice it left is already made)
    if (effect.advance !== null) {
      const reversed = reverseAdvanceEffect(working, playerOf(working, player.playerId) ?? player, record, effect.advance, at)
      if (!reversed.ok) return reversed
      working = reversed.value.state
      notes.push('the free advance was taken back')
    }
    if (effect.culture > 0) {
      // As much as is still there goes back: what the Chinese have spent since stays spent, as with the Aztec and Arab gains
      const holder = playerOf(working, player.playerId) ?? player
      const taken = Math.min(holder.stats.culture, effect.culture)
      working = withPlayerHand(working, { ...holder, stats: { ...holder.stats, culture: holder.stats.culture - taken } })
      notes.push(`took back ${tookBackText(taken, effect.culture, holder.stats.culture - taken)}`)
    }
    // The offer is open again, so it can be answered anew
    const offers = working.conquestOffers ?? []
    if (!offers.some((candidate) => candidate.id === effect.offer.id)) working = withConquestOffers(working, [...offers, effect.offer])
    return ok({
      state: working,
      text: `${player.username}'s answer to the conquest of the ${whatOf(effect.offer)} was undone: ${[...notes, 'the offer is open again'].join(', ')}`,
    })
  },
}

export const CONQUEST_ACTIONS: readonly AssistedActionDefinition[] = [claimConquest]
