/**
 * Answering a conquest offer (issue #368): the player takes the village (its token goes to their area, its card into their
 * hand) and the civ's extra, the Romans' free advance on the culture track or the Chinese 3 culture, or declines and leaves
 * the token on the map. The offer is made when a battle for a village or a city is won (`conquest.ts`); nothing is ever
 * gained without this answer.
 *
 * The undo (an undo vote on the action's line, as for every assisted action) takes the gain back and opens the offer again,
 * so it can be answered anew. Nothing may be farmed by answering again, so it is refused while the village card has left the
 * hand or the Chinese culture is spent.
 */

import { blocked, lastLogId, playerOf, rejected, withPlayerHand } from './assisted-core.js'
import type { AssistedActionDefinition, AssistedPayload, ClaimConquestPayload } from './assisted-core.js'
import { freeAdvanceStatus, performAdvance, reverseAdvanceEffect } from './assisted-culture.js'
import { collectMapToken } from './actions/collect-token.js'
import { movePieceUnchecked } from './actions/board.js'
import { returnCollectedCard } from './actions/tile-tokens.js'
import { squareLabel } from './build-options.js'
import { conquestCivOf, withConquestOffers } from './conquest.js'
import type { Result } from './result.js'
import type { EngineError } from './errors.js'
import { appendLog, appendPublicLog } from './log.js'
import { err, ok } from './result.js'
import type { ConquestOffer, ConquestOfferView, CultureAdvanceEffect, GameState, Playerhand } from './state.js'

type VillageTaken = NonNullable<Extract<GameState['assistedActions'][number]['effect'], { kind: 'conquestClaim' }>['village']> | null
import { mapTokensOf } from './zheng-he.js'
import type { MapToken } from './zheng-he.js'

/** The Chinese gain this much culture for conquering a village (civilization card). */
export const CHINESE_CONQUEST_CULTURE = 3

const claimPayloadOf = (payload: AssistedPayload | undefined): ClaimConquestPayload | undefined =>
  payload !== undefined && 'offerId' in payload && typeof payload.offerId === 'string' && 'accept' in payload && typeof payload.accept === 'boolean'
    ? { offerId: payload.offerId, accept: payload.accept }
    : undefined

const whatOf = (offer: ConquestOffer): string => `${offer.kind === 'village' ? 'village' : 'city'} on ${offer.square}`

/** " as the Romans": the civ the reward comes from, nothing for a player without a civ. */
const asOf = (offer: ConquestOffer): string => (offer.civ === '' ? '' : ` as the ${offer.civ}`)

/** What the reward is called in a line: "the free advance", "the 3 culture", or just "the village" for any other civ. */
const rewardOf = (offer: ConquestOffer): string =>
  offer.civ === 'Romans' ? 'the free advance' : offer.civ === 'Chinese' ? `the ${CHINESE_CONQUEST_CULTURE} culture` : `the ${offer.kind}`

/** The village token of a village offer that still lies on its square, if any. */
function villageTokenOf(state: GameState, offer: Pick<ConquestOffer, 'kind' | 'square'>): MapToken | undefined {
  if (offer.kind !== 'village') return undefined
  return mapTokensOf(state.board).find((token) => token.sheet === 'VILLAGES' && squareLabel(token.cell) === offer.square)
}

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
    villageGone: offer.kind === 'village' && villageTokenOf(state, offer) === undefined,
  }))
}

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
      const logged = announce(open, `${player.username} declined ${rewardOf(offer)} for conquering the ${whatOf(offer)}${asOf(offer)}`)
      return ok({
        state: logged,
        effect: { kind: 'conquestClaim', offer, accepted: false, culture: 0, advance: null, village: null },
        logId: lastLogId(logged),
      })
    }

    // The village goes last, after the civ's extra: the extra's board moves stay on top of the history and the card it draws
    // cannot change what the extra may do. A token that is gone, or no card to draw, leaves the extra to be taken alone.
    const takeVillage = (base: GameState): Result<{ state: GameState; village: VillageTaken }, EngineError> => {
      const token = villageTokenOf(base, offer)
      const holder = playerOf(base, player.playerId) ?? player
      if (offer.kind !== 'village') return ok({ state: base, village: null })
      if (token === undefined) {
        const text = `could not take the village: its token on ${offer.square} is no longer there`
        return ok({ state: appendPublicLog(base, holder.username, holder.playerId, text), village: null })
      }
      const collected = collectMapToken(base, player.playerId, token, { at: context.at, chineseCulture: false })
      const collection = collected?.tokenCollections?.at(-1)
      if (collected === undefined || collection === undefined) {
        if (conquestCivOf(holder) === undefined) return err(rejected('claimConquest', blocked('unavailable', `No village card could be drawn, so the village on ${offer.square} cannot be taken now.`)))
        const text = `could not take the village: no village card could be drawn, so its token stays on ${offer.square}`
        return ok({ state: appendPublicLog(base, holder.username, holder.playerId, text), village: null })
      }
      const taken = appendPublicLog(collected, holder.username, holder.playerId, `took the village token on ${offer.square} into their area`)
      return ok({
        state: taken,
        village: { historyId: collection.historyId, pieceId: token.piece.id, from: { x: token.piece.x, y: token.piece.y }, itemId: collection.itemId },
      })
    }
    const finish = (base: GameState, extra: { readonly culture: number; readonly advance: CultureAdvanceEffect | null }, logId: string) => {
      const village = takeVillage(base)
      if (!village.ok) return village
      return ok({
        state: village.value.state,
        effect: { kind: 'conquestClaim' as const, offer, accepted: true, ...extra, village: village.value.village },
        logId,
      })
    }

    if (offer.civ === 'Chinese') {
      const culture = CHINESE_CONQUEST_CULTURE
      const total = player.stats.culture + culture
      const gained = withPlayerHand(open, { ...player, stats: { ...player.stats, culture: total } })
      const logged = announce(gained, `${player.username} gained ${culture} (${total}) culture for conquering the ${whatOf(offer)} as the Chinese`)
      return finish(logged, { culture, advance: null }, lastLogId(logged))
    }

    if (offer.civ !== 'Romans') {
      const logged = announce(open, `${player.username} conquered the ${whatOf(offer)}${asOf(offer)}`)
      return finish(logged, { culture: 0, advance: null }, lastLogId(logged))
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
      return finish(logged, { culture: 0, advance: null }, lastLogId(logged))
    }
    const logged = announce(open, `${player.username} took the free advance for conquering the ${whatOf(offer)} as the Romans`)
    const logId = lastLogId(logged)
    const advanced = performAdvance(logged, playerOf(logged, player.playerId) ?? player, { requestId: context.requestId, at: context.at }, { free: true, tagLog: false })
    if (!advanced.ok) return advanced
    return finish(advanced.value.state, { culture: 0, advance: advanced.value.effect }, logId)
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'conquestClaim') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refuse = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
    let working = state
    const notes: string[] = []
    // Nothing may be farmed by taking an answer back and giving it again, so a reward that is spent is not taken back clamped:
    // the Chinese culture must still be there, and the village card still in the hand (as for the hut, `BOARD_UNDO_TOKEN_CULTURE_SPENT`)
    if (effect.culture > 0) {
      const holder = playerOf(working, player.playerId) ?? player
      if (holder.stats.culture < effect.culture) {
        return refuse(
          `Only ${holder.stats.culture} culture is left, so the ${effect.culture} culture for the ${whatOf(effect.offer)} cannot be taken back. It has been spent, or the counter was changed by hand. Undo is refused so the reward cannot be taken twice.`,
        )
      }
    }
    // The village goes back first: the token to its square and the card out of the hand
    if (effect.village != null) {
      const village = effect.village
      // A board Undo may already have put it back
      const collection = working.tokenCollections?.find((candidate) => candidate.historyId === village.historyId)
      if (collection !== undefined) {
        const returned = returnCollectedCard(working, collection)
        if (returned === undefined) {
          return refuse(`The village card from ${collection.square} has left the hand, so the answer cannot be undone (the village could be taken twice).`)
        }
        const moved = movePieceUnchecked(returned, {
          playerId: player.playerId,
          pieceId: village.pieceId,
          x: village.from.x,
          y: village.from.y,
          snap: false,
          ...(at === null ? {} : { at }),
        })
        if (moved === undefined) return refuse(`The village token of ${collection.square} could not be put back.`)
        working = moved
        notes.push('the village token is back on the map')
      }
    }
    // The advance goes next: it can refuse (the marker has moved on, or a card choice it left is already made)
    if (effect.advance !== null) {
      const reversed = reverseAdvanceEffect(working, playerOf(working, player.playerId) ?? player, record, effect.advance, at)
      if (!reversed.ok) return reversed
      working = reversed.value.state
      notes.push('the free advance was taken back')
    }
    if (effect.culture > 0) {
      const holder = playerOf(working, player.playerId) ?? player
      working = withPlayerHand(working, { ...holder, stats: { ...holder.stats, culture: holder.stats.culture - effect.culture } })
      notes.push(`took back ${effect.culture} (${holder.stats.culture - effect.culture}) culture`)
    }
    // The offer is open again, so it can be answered anew
    const offers = working.conquestOffers ?? []
    if (!offers.some((candidate) => candidate.id === effect.offer.id)) working = withConquestOffers(working, [...offers, effect.offer])
    // The token went back with moves of its own: the board Undo must not walk past them into the forward move
    if (effect.village != null) working = { ...working, board: { ...working.board, redo: [], undoFloor: working.board.history.length } }
    return ok({
      state: working,
      text: `${player.username}'s answer to the conquest of the ${whatOf(effect.offer)} was undone: ${[...notes, 'the offer is open again'].join(', ')}`,
    })
  },
}

export const CONQUEST_ACTIONS: readonly AssistedActionDefinition[] = [claimConquest]
