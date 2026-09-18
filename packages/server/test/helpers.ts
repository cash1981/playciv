/**
 * A small `fastify.inject`-shaped wrapper around `app.request`, so the tests
 * read the same as before the Hono migration.
 */

import type { App } from '../src/app.js'

export interface InjectOptions {
  readonly method?: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly payload?: unknown
}

export interface InjectResponse {
  readonly status: number
  readonly body: string
  json<T = unknown>(): Promise<T>
  text(): Promise<string>
}

export async function inject(app: App, opts: InjectOptions): Promise<InjectResponse> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
  }
  if (opts.payload !== undefined) {
    init.body = JSON.stringify(opts.payload)
  }

  const res = await app.request(opts.url, init)
  const body = await res.clone().text()
  return {
    status: res.status,
    body,
    json: async <T = unknown>(): Promise<T> => JSON.parse(body) as T,
    text: async () => body,
  }
}

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
})
