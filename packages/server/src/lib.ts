/**
 * The importable surface of `@civ/server`, for the Cloudflare Worker to build
 * on. The Node entry point (`index.ts`) is not part of this — it wires up
 * `@hono/node-server` and process signals, which do not exist on workerd.
 */

export { createApp, createTestApp } from './app.js'
export type { App, CreateAppOptions, TestAppOptions } from './app.js'
export { D1Repository } from './store/d1.js'
export type { D1Database, D1PreparedStatement, D1Result } from './store/d1.js'
export { TokenSigner } from './auth.js'
export { createResendMailer, noopMailer } from './mail.js'
export type { Mailer, OutgoingEmail } from './mail.js'
export { createNotifications, DEFAULT_APP_ORIGIN } from './notifications.js'
export type { Notifications, NotificationsConfig } from './notifications.js'
