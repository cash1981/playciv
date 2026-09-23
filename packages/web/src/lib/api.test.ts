// @vitest-environment jsdom

/**
 * `request()` has two jobs worth testing here: a body that is not JSON must
 * never surface as a raw `SyntaxError` (Cloudflare answers a Worker that
 * exceeded its limits with `503` and a plain-text `error code: 1102`), and a
 * transient gateway failure of a safe request gets a bounded retry while a
 * write does not.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, storeToken } from './api.js'

/** A response stub with only the surface `request()` touches. */
interface StubResponse {
  readonly status: number
  readonly statusText: string
  readonly ok: boolean
  readonly text: () => Promise<string>
}

function stubResponse(status: number, body: string, statusText = ''): StubResponse {
  return { status, statusText, ok: status >= 200 && status < 300, text: async () => body }
}

/** Stubs `fetch` with one fixed response; returns the mock for call counts. */
function respondWith(status: number, body: string, statusText = ''): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => stubResponse(status, body, statusText))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Stubs `fetch` with one response per call, repeating the last one. */
function respondInSequence(responses: readonly StubResponse[]): ReturnType<typeof vi.fn> {
  let call = 0
  const fetchMock = vi.fn(async () => {
    const response = responses[Math.min(call, responses.length - 1)]
    call += 1
    return response ?? stubResponse(500, '')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Resolves to the rejection value, avoiding `.catch` swallowing the type. */
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(() => undefined, (caught: unknown) => caught)

beforeEach(() => {
  // Only the retry back-off uses timers, and driving it explicitly keeps the
  // suite fast. The promise chain is untouched.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  storeToken(null)
})

describe('api request error handling', () => {
  it('reports a non-JSON error body instead of throwing a SyntaxError', async () => {
    const fetchMock = respondWith(503, 'error code: 1102')

    const caught = rejectionOf(api.game('b87c44725c869148'))
    await vi.advanceTimersByTimeAsync(2_000)
    const error = await caught

    expect(error).toBeInstanceOf(ApiError)
    expect(error).not.toBeInstanceOf(SyntaxError)
    expect((error as ApiError).status).toBe(503)
    expect((error as ApiError).message).toContain('503')
    expect((error as ApiError).message).toContain('error code: 1102')
    // The initial attempt plus the two retries, then give up.
    expect(fetchMock).toHaveBeenCalledTimes(3)
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

describe('api retry on a transient gateway failure', () => {
  it('retries a GET 250 ms after a 503, then succeeds', async () => {
    const fetchMock = respondInSequence([
      stubResponse(503, 'error code: 1102'),
      stubResponse(200, JSON.stringify({ id: 'some-game', rev: 4 }), 'OK'),
    ])

    const pending = api.game('some-game')
    // The retry is not made before the 250 ms back-off elapses.
    await vi.advanceTimersByTimeAsync(249)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toEqual({ id: 'some-game', rev: 4 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a GET twice, waiting 250 ms and then 1 s', async () => {
    const fetchMock = respondInSequence([
      stubResponse(503, ''),
      stubResponse(502, ''),
      stubResponse(200, JSON.stringify({ status: 'ok' }), 'OK'),
    ])

    const pending = api.game('some-game')
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The second wait is 1 s, so the third attempt is not made at 999 ms.
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toEqual({ status: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a write, because the game actions are not idempotent', async () => {
    const fetchMock = respondWith(503, 'error code: 1102')

    const caught = await rejectionOf(api.endTurn('some-game'))

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 500 from our own server', async () => {
    const fetchMock = respondWith(
      500,
      JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Something went wrong' }),
    )

    const caught = await rejectionOf(api.game('some-game'))

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('INTERNAL_ERROR')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
