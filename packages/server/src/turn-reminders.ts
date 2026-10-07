import { activeTurnStatus } from '@civ/engine'

import type { Mailer } from './mail.js'
import { MailError } from './mail.js'
import { DEFAULT_APP_ORIGIN } from './notifications.js'
import type { Repository } from './store/types.js'

export const TURN_REMINDER_WAIT_MS = 72 * 60 * 60 * 1000
// Two scan queries, four queries per game (including rejection release), nine sends: 47.
export const TURN_REMINDER_SCAN_LIMIT = 9

export interface TurnReminderConfig {
  readonly repo: Repository
  readonly mailer: Mailer
  readonly enabled: boolean
  readonly appOrigin?: string
  readonly sleep?: (ms: number) => Promise<void>
}

export interface TurnReminderResult {
  readonly checked: number
  readonly claimed: number
  readonly sent: number
  readonly failed: number
}

/** A claim records an attempt. Ambiguous provider failures must never cause duplicate mail. */
export async function runDailyTurnReminders(config: TurnReminderConfig, now: Date): Promise<TurnReminderResult> {
  let checked = 0
  let claimed = 0
  let sent = 0
  let failed = 0
  if (!config.enabled) return { checked, claimed, sent, failed }
  const origin = (config.appOrigin ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, '')
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  try {
    const candidates = await config.repo.idleTurnCandidates(now, TURN_REMINDER_WAIT_MS, TURN_REMINDER_SCAN_LIMIT)
    for (const candidate of candidates) {
      checked += 1
      const game = await config.repo.findGame(candidate.gameId)
      if (game === undefined || !game.active) continue
      const turn = activeTurnStatus(game)
      if (turn === null) continue
      const player = await config.repo.findPlayerById(turn.playerId)
      if (player === undefined || player.disabled === true || player.disableEmail === true || !player.email?.trim()) continue
      if (claimed > 0) await sleep(600)
      if (!await config.repo.claimTurnReminder(candidate, player.id, player.email, now, TURN_REMINDER_WAIT_MS)) continue
      claimed += 1
      try {
        // Only public game identity and an obligation; no log, orders or private state.
        await config.mailer.send({
          to: player.email,
          subject: `Reminder: it is your turn in ${game.name}`,
          text: `It is your turn in ${game.name}. This game has had no saved action for more than three days.\n\n` +
            `${origin}/game/${encodeURIComponent(game.id)}\n\n` +
            'If you wish to unsubscribe from ALL emails, then push this link: ' +
            `${origin}/api/admin/email/notification/${encodeURIComponent(player.id)}/stop`,
        })
        sent += 1
      } catch (error) {
        failed += 1
        if (error instanceof MailError) {
          await config.repo.releaseTurnReminder(candidate)
          console.error('Turn reminder rejected; released for a future daily run')
          // Quota, authentication and provider failures affect subsequent sends too.
          if (![400, 413, 422].includes(error.status)) break
        } else {
          console.error('Turn reminder delivery uncertain; its durable attempt will not be retried')
        }
      }
    }
  } catch {
    console.error('Daily turn reminder job failed')
  }
  return { checked, claimed, sent, failed }
}
