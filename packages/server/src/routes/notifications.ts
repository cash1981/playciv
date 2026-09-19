/**
 * Java: `resource/AdminResource.java` — the two unsubscribe links that every
 * mail carries, `.../email/notification/{playerId}/stop` and `/start`.
 *
 * Both are deliberately unauthenticated, exactly as Java had them: the link in
 * an email cannot carry a bearer token. The player id is opaque and the only
 * action is to flip the account's own `disableEmail` flag. The HTML is Java's,
 * wrapper and all; only the "start" link's host differs (it uses `APP_ORIGIN`
 * rather than the request URL, because the API is reached through the Worker on
 * a different host).
 */

import type { App } from '../app.js'
import type { AppContext } from '../context.js'

export function registerNotificationRoutes(app: App, context: AppContext): void {
  app.get('/api/admin/email/notification/:playerId/stop', async (c) => {
    const playerId = c.req.param('playerId')
    const updated = await context.repo.updatePlayer(playerId, { disableEmail: true })
    // Java answered a bad playerId with a bare 400, no entity.
    if (updated === undefined) return c.body(null, 400)

    const startUrl =
      `${context.appOrigin}/api/admin/email/notification/` +
      `${encodeURIComponent(playerId)}/start`
    return c.html(
      '<html><body>' +
        "<h1>You will no longer get anymore emails. Don't forget to check in once in a " +
        'while</h1> If you reconsider and want to get emails again, then push ' +
        `<a href="${startUrl}">here</a>` +
        '</body></html>',
    )
  })

  app.get('/api/admin/email/notification/:playerId/start', async (c) => {
    const playerId = c.req.param('playerId')
    const updated = await context.repo.updatePlayer(playerId, { disableEmail: false })
    if (updated === undefined) return c.body(null, 400)
    return c.html('<h1>Your email has started again</h1>')
  })
}
