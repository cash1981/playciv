// @vitest-environment jsdom

/**
 * `request()` has two jobs worth testing here: a body that is not JSON must
 * never surface as a raw `SyntaxError` (Cloudflare answers a Worker that
 * exceeded its limits with `503` and a plain-text `error code: 1102`), and a
 * transient gateway failure of a safe request gets a bounded retry while a
 * write does not.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useIsBusy } from './activity.js'
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
  cleanup()
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

describe('api chat orders calls (issue #215)', () => {
  /** The path and the parsed JSON body of the one call the stub received. */
  const lastCall = (fetchMock: ReturnType<typeof vi.fn>): { path: unknown; body: unknown } => {
    const [path, init] = fetchMock.mock.calls[0] as [unknown, { body?: string } | undefined]
    return { path, body: init?.body === undefined ? undefined : JSON.parse(init.body) }
  }

  it('asks for the current page, then for the turn before a message', async () => {
    const fetchMock = respondWith(200, JSON.stringify({ messages: [], hasMore: false }))
    await api.chatPage('g1')
    expect(lastCall(fetchMock).path).toBe('/api/games/g1/chat?paged=1')

    const second = respondWith(200, JSON.stringify({ messages: [], hasMore: false }))
    await api.chatPage('g1', 'm 1')
    expect(lastCall(second).path).toBe('/api/games/g1/chat?paged=1&before=m%201')
  })

  it('sends the turn only when it is given', async () => {
    const fetchMock = respondWith(200, '{}')
    await api.postOrder('g1', 'TRADE', 'Buy iron')
    expect(lastCall(fetchMock)).toEqual({
      path: '/api/games/g1/turns/order',
      body: { phase: 'TRADE', markdown: 'Buy iron' },
    })

    const second = respondWith(200, '{}')
    await api.markDone('g1', 'CM', 4)
    expect(lastCall(second)).toEqual({
      path: '/api/games/g1/turns/done',
      body: { phase: 'CM', turnNumber: 4 },
    })

    const third = respondWith(200, '{}')
    await api.unmarkDone('g1', 'CM', 4)
    expect(lastCall(third).path).toBe('/api/games/g1/turns/undone')
  })

  it('adds confirmedOutOfTurn to a draw only when it is true', async () => {
    const plain = respondWith(200, '{}')
    await api.draw('g1', 'CIV')
    expect(lastCall(plain).body).toEqual({})

    const declined = respondWith(200, '{}')
    await api.draw('g1', 'CIV', false)
    expect(lastCall(declined).body).toEqual({})

    const confirmed = respondWith(200, '{}')
    await api.draw('g1', 'ANCIENT_WONDERS', true)
    expect(lastCall(confirmed)).toEqual({
      path: '/api/games/g1/draw/ANCIENT_WONDERS',
      body: { confirmedOutOfTurn: true },
    })
  })

  it('switches chat orders through the admin route', async () => {
    const fetchMock = respondWith(200, '{}')
    await api.setChatOrders('g1', true)
    expect(lastCall(fetchMock)).toEqual({
      path: '/api/admin/games/g1/chat-orders',
      body: { enabled: true },
    })
  })
})

describe('api requests and the global spinner', () => {
  /** A fetch that answers only when the test says so. */
  function heldFetch(): { release: (status: number, body: string) => void } {
    let release: (response: StubResponse) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<StubResponse>((resolve) => { release = resolve })),
    )
    return { release: (status, body) => release(stubResponse(status, body)) }
  }

  it('reports a write as busy until it has finished', async () => {
    const busy = renderHook(() => useIsBusy())
    const held = heldFetch()

    let pending: Promise<unknown> = Promise.resolve()
    act(() => { pending = api.endTurn('g1') })
    expect(busy.result.current).toBe(true)

    await act(async () => {
      held.release(200, '{}')
      await pending
    })
    expect(busy.result.current).toBe(false)
  })

  it('stops reporting a write that failed', async () => {
    const busy = renderHook(() => useIsBusy())
    const held = heldFetch()

    let pending: Promise<unknown> = Promise.resolve()
    act(() => { pending = rejectionOf(api.endTurn('g1')) })
    expect(busy.result.current).toBe(true)

    await act(async () => {
      held.release(409, '{"error":"CONFLICT","message":"stale"}')
      await pending
    })
    expect(busy.result.current).toBe(false)
  })

  it('does not report a read, because most reads are background polls', async () => {
    const busy = renderHook(() => useIsBusy())
    const held = heldFetch()

    let pending: Promise<unknown> = Promise.resolve()
    act(() => { pending = api.gameRev('g1') })
    expect(busy.result.current).toBe(false)

    await act(async () => {
      held.release(200, '{"rev":1}')
      await pending
    })
    expect(busy.result.current).toBe(false)
  })
})
