/**
 * Java: `resource/AdminResource.java` — the two unsubscribe links that every
 * mail carries, `.../email/notification/{playerId}/stop` and `/start`.
 *
 * Both are deliberately unauthenticated, exactly as Java had them: the link in
 * an email cannot carry a bearer token. The player id is opaque and the only
 * action is to flip the account's own `disableEmail` flag.
 */

import type { App } from '../app.js'
import type { AppContext } from '../context.js'

function page(body: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>Email notifications</title></head><body>' +
    body +
    '</body></html>'
  )
}

export function registerNotificationRoutes(app: App, context: AppContext): void {
  app.get('/api/admin/email/notification/:playerId/stop', async (c) => {
    const playerId = c.req.param('playerId')
    const updated = await context.repo.updatePlayer(playerId, { disableEmail: true })
    if (updated === undefined) {
      return c.html(page('<h1>Unknown player</h1>'), 400)
    }
    const startUrl = `${context.appOrigin}/api/admin/email/notification/${playerId}/start`
    return c.html(
      page(
        "<h1>You will no longer get anymore emails. Don't forget to check in once in a " +
          'while</h1> If you reconsider and want to get emails again, then push ' +
          `<a href="${startUrl}">here</a>`,
      ),
    )
  })

  app.get('/api/admin/email/notification/:playerId/start', async (c) => {
    const playerId = c.req.param('playerId')
    const updated = await context.repo.updatePlayer(playerId, { disableEmail: false })
    if (updated === undefined) {
      return c.html(page('<h1>Unknown player</h1>'), 400)
    }
    return c.html(page('<h1>Your email has started again</h1>'))
  })
}
