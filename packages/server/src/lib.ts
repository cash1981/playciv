/**
 * The importable surface of `@civ/server`, for the Cloudflare Worker to build
 * on. The Node entry point (`index.ts`) is not part of this — it wires up
 * `@hono/node-server` and process signals, which do not exist on workerd.
 */

export { createApp, createTestApp } from './app.js'
export type { CreateAppOptions, TestAppOptions } from './app.js'
export { MongoRepository } from './store/mongo.js'
export { TokenSigner } from './auth.js'
export { createResendMailer, noopMailer } from './mail.js'
export type { Mailer, OutgoingEmail } from './mail.js'
export { createNotifications, DEFAULT_APP_ORIGIN } from './notifications.js'
export type { Notifications, NotificationsConfig } from './notifications.js'
