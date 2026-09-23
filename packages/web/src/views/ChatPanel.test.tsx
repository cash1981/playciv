// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { PlayerDto } from '../lib/api.js'
import { ChatPanel } from './ChatPanel.js'

vi.mock('../lib/api.js', () => ({ api: { chat: vi.fn() } }))

const player = { id: 'one', username: 'One' } as PlayerDto
const chat = vi.mocked(api.chat)

describe('ChatPanel auto-refresh', () => {
  beforeEach(() => localStorage.setItem('civ.panel.chat', 'true'))
  afterEach(() => {
    cleanup()
    localStorage.removeItem('civ.panel.chat')
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

  it('keeps newer chat when an older request completes last', async () => {
    let finishOld: ((messages: Awaited<ReturnType<typeof api.chat>>) => void) | undefined
    chat.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce([{
        id: 'new', username: 'Two', message: 'New message', createdAt: '2020-01-02',
      }])
    render(<ChatPanel gameId="game" busy={false} run={async () => {}} player={player} reloadCount={0} autoRefresh={false} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    expect(screen.getByText('New message')).toBeTruthy()
    await act(async () => { finishOld?.([]) })
    expect(screen.getByText('New message')).toBeTruthy()
    expect(chat).toHaveBeenCalledTimes(2)
  })
})
