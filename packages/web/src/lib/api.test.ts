// @vitest-environment jsdom

/**
 * `request()` must never surface a raw `SyntaxError` for a response that is not
 * JSON. Cloudflare answers a Worker that exceeded its limits with `503` and a
 * plain-text `error code: 1102`, which is what the live game page showed as
 * "JSON.parse: unexpected character at line 1 column 1 of the JSON data".
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, storeToken } from './api.js'

/** A response stub with only the surface `request()` touches. */
function respondWith(status: number, body: string, statusText = ''): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status,
      statusText,
      ok: status >= 200 && status < 300,
      text: async (): Promise<string> => body,
    })),
  )
}

/** Resolves to the rejection value, avoiding `.catch` swallowing the type. */
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(() => undefined, (caught: unknown) => caught)

afterEach(() => {
  vi.unstubAllGlobals()
  storeToken(null)
})

describe('api request error handling', () => {
  it('reports a non-JSON error body instead of throwing a SyntaxError', async () => {
    respondWith(503, 'error code: 1102')

    const caught = await rejectionOf(api.game('b87c44725c869148'))

    expect(caught).toBeInstanceOf(ApiError)
    expect(caught).not.toBeInstanceOf(SyntaxError)
    expect((caught as ApiError).status).toBe(503)
    expect((caught as ApiError).message).toContain('503')
    expect((caught as ApiError).message).toContain('error code: 1102')
  })

  it('keeps the server error code and message when the body is JSON', async () => {
    respondWith(
      500,
      JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Something went wrong' }),
      'Internal Server Error',
    )

    const caught = await rejectionOf(api.game('some-game'))

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('INTERNAL_ERROR')
    expect((caught as ApiError).message).toBe('Something went wrong')
  })

  it('rejects a 2xx body that is not JSON', async () => {
    respondWith(200, '<!doctype html>')

    const caught = await rejectionOf(api.game('some-game'))

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('INVALID_RESPONSE')
  })

  it('returns the parsed payload for a normal JSON response', async () => {
    respondWith(200, JSON.stringify({ id: 'some-game', rev: 3 }), 'OK')

    await expect(api.game('some-game')).resolves.toEqual({ id: 'some-game', rev: 3 })
  })
})
