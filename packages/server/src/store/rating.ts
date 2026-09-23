import { highscore, rankByEvidence, totalCoins } from '@civ/engine'
import type { FinishedGame, GameState, HighscoreResult, PlacementEvidence, RatedGame } from '@civ/engine'
import { ordinal, rate, rating } from 'openskill'

import type { StoredPlayer } from './types.js'

/** Replays immutable results, so a corrected backfill can rebuild the cache once. */
export function ratedHighscore(
  games: readonly FinishedGame[],
  players: readonly StoredPlayer[],
  results: readonly RatedGame[],
): HighscoreResult {
  const skill = new Map<string, ReturnType<typeof rating>>()
  const counts = new Map<string, number>()
  for (const player of players) skill.set(player.username, rating())
  for (const game of [...results].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id))) {
    if (game.participants.length < 2 || game.participants.length > 5) continue
    const teams = game.participants.map(({ username }) => [skill.get(username) ?? rating()])
    const updated = rate(teams, { rank: game.participants.map(({ rank }) => rank) })
    game.participants.forEach(({ username }, index) => {
      const next = updated[index]?.[0]
      if (next !== undefined) skill.set(username, next)
      counts.set(username, (counts.get(username) ?? 0) + 1)
    })
  }
  return {
    ...highscore(games, players.map((player) => player.username)),
    ratings: [...skill].map(([username, value]) => ({
      username,
      rating: Math.round(ordinal(value) * 100) / 100,
      uncertainty: Math.round(value.sigma * 100) / 100,
      games: counts.get(username) ?? 0,
    })),
  }
}

/** Fresh games retain public coin counters; historical games use the legacy extractor. */
export function resultFromGame(game: GameState): RatedGame | null {
  if (game.active || game.winner === null || game.winner === '') return null
  const evidence: PlacementEvidence[] = game.players.map((player) => {
    const culture = player.items
      .filter((item) => item.ownerId === player.playerId)
      .reduce((tier, item) => Math.max(tier, item.kind === 'cultureIII' ? 3 : item.kind === 'cultureII' ? 2 : item.kind === 'cultureI' ? 1 : 0), 0)
    return {
      username: player.username,
      techs: player.techsChosen.length,
      cultureTier: culture || null,
      coins: totalCoins(player.stats.coinSources),
    }
  })
  return {
    id: `game:${game.id}`,
    sortKey: game.createdAt ?? '',
    participants: rankByEvidence(game.winner, evidence),
  }
}
