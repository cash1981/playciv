/**
 * The one place that builds and sends the email-verification link (issue #42).
 *
 * Register, the resend route, social completion and the admin action all use
 * it, so the token, the link shape and the "no mailer" fallback exist once. It
 * mirrors `passwordReset`: a send failure is logged by `Notifications`, never
 * thrown at the caller, because a mail problem must not fail a request that has
 * already changed state.
 */

import type { AppContext } from './context.js'
import type { StoredPlayer } from './store/types.js'

export async function sendVerificationEmail(
  context: AppContext,
  player: StoredPlayer,
): Promise<void> {
  // A provider can return no address; there is then nothing to verify and no
  // one to send to (the client asks for an address instead).
  if (player.email === null || player.email === '') return

  const token = context.verifyTokens.sign({ playerId: player.id })
  const link = `${context.appOrigin}/api/auth/verify-email/${token}`

  // With no mailer the account cannot be verified by mail — local development,
  // or production with RESEND_API_KEY missing. The owner chose to print the
  // link instead; registration marks such an account verified (see the route).
  if (!context.notifications.emailDeliveryEnabled) {
    console.warn(
      'RESEND_API_KEY is not set, so no verification email was sent. ' +
        `Verification link for ${player.email}: ${link} ` +
        '(production behaves the same while RESEND_API_KEY is missing).',
    )
    return
  }

  await context.notifications.emailVerification(player.email, link)
}
