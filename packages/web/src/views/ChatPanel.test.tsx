// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { PlayerDto } from '../lib/api.js'
import { ChatPanel } from './ChatPanel.js'

vi.mock('../lib/api.js', () => ({ api: { chat: vi.fn() } }))

const player = { id: 'one', username: 'One' } as PlayerDto
const chat = vi.mocked(api.chat)

describe('ChatPanel auto-refresh', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('reads new chat after ten seconds without a game reload', async () => {
    vi.useFakeTimers()
    chat.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 'message-1', username: 'Two', message: 'Hello', createdAt: '2020-01-01',
    }])
    await act(async () => {
      render(<ChatPanel gameId="game" busy={false} run={async () => {}} player={player} reloadCount={0} autoRefresh />)
    })
    expect(chat).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(chat).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Hello')).toBeTruthy()
  })

  it('stops polling when auto-refresh is off', async () => {
    vi.useFakeTimers()
    chat.mockResolvedValue([])
    await act(async () => {
      render(<ChatPanel gameId="game" busy={false} run={async () => {}} player={player} reloadCount={0} autoRefresh={false} />)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(chat).toHaveBeenCalledTimes(1)
  })
})
