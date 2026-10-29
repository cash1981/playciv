// @vitest-environment jsdom


import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchDeployedBuildId, isNewerBuild } from '../lib/buildVersion.js'
import { UpdateBanner } from './UpdateBanner.js'

const answer = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('build version', () => {
  it('reads the deployed id and ignores anything else', async () => {
    expect(await fetchDeployedBuildId(answer({ id: 'abc' }))).toBe('abc')
    expect(await fetchDeployedBuildId(answer({ id: '' }))).toBeNull()
    expect(await fetchDeployedBuildId(answer({}))).toBeNull()
    expect(await fetchDeployedBuildId(answer('<html>', true))).toBeNull()
    expect(await fetchDeployedBuildId(answer({ id: 'abc' }, false))).toBeNull()
    expect(await fetchDeployedBuildId((async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
    // The host answers a missing file with the page: not JSON
    expect(
      await fetchDeployedBuildId((async () => ({ ok: true, json: async () => { throw new SyntaxError('html') } })) as unknown as typeof fetch),
    ).toBeNull()
  })

  it('is newer only for a different id, and never in dev', () => {
    expect(isNewerBuild('a', 'b')).toBe(true)
    expect(isNewerBuild('a', 'a')).toBe(false)
    expect(isNewerBuild('a', null)).toBe(false)
    expect(isNewerBuild('dev', 'b')).toBe(false)
  })
})

describe('UpdateBanner', () => {
  it('offers a reload when a different build is deployed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(answer({ id: 'new' }))
    render(<UpdateBanner running="old" />)
    await waitFor(() => expect(screen.getByText(/new version of Playciv/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('stays out of the way when the build is the same, or in dev', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(answer({ id: 'same' }))
    render(<UpdateBanner running="same" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('status')).toBeNull()
    cleanup()
    spy.mockClear()
    render(<UpdateBanner running="dev" />)
    fireEvent(document, new Event('visibilitychange'))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
