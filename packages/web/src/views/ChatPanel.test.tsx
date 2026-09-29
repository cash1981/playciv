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

describe('ChatPanel authors (issue #206)', () => {
  beforeEach(() => localStorage.setItem('civ.panel.chat', 'true'))
  afterEach(() => {
    cleanup()
    localStorage.removeItem('civ.panel.chat')
    vi.clearAllMocks()
  })

  const messages = [
    { id: 'm1', username: 'Alice', message: 'Hello', createdAt: '2020-01-01' },
    { id: 'm2', username: 'Ghost', message: 'Still here', createdAt: '2020-01-02' },
  ]

  async function renderChat(
    authors: ReadonlyMap<string, { civilization: string | null; color: string | null }>,
  ): Promise<HTMLElement> {
    chat.mockResolvedValue(messages)
    let container: HTMLElement | undefined
    await act(async () => {
      container = render(
        <ChatPanel gameId="game" busy={false} run={async () => {}} player={player} reloadCount={0} autoRefresh={false} authors={authors} />,
      ).container
    })
    if (container === undefined) throw new Error('chat did not render')
    return container
  }

  it('shows the civ, then the coloured nickname, then the message', async () => {
    const container = await renderChat(new Map([['Alice', { civilization: 'Greeks', color: 'Purple' }]]))
    const line = Array.from(container.querySelectorAll('li')).find((li) => li.textContent?.includes('Alice'))
    if (line === undefined) throw new Error('Alice line missing')

    const author = line.querySelector('.chat-author')
    expect(Array.from(author?.children ?? []).map((child) => child.textContent)).toEqual(['Greeks', 'Alice'])
    expect(author?.querySelector('small')?.textContent).toBe('Greeks')
    expect(author?.querySelector('strong')?.className).toBe('player-purple')
    expect(author?.querySelector('small')?.className).toBe('player-purple')
    // The author comes before the message text
    expect(author?.nextElementSibling?.textContent).toBe('Hello')
  })

  it('still renders a message whose username cannot be matched, as plain text', async () => {
    const container = await renderChat(new Map([['Alice', { civilization: 'Greeks', color: 'Blue' }]]))
    const line = Array.from(container.querySelectorAll('li')).find((li) => li.textContent?.includes('Ghost'))
    if (line === undefined) throw new Error('Ghost line missing')

    expect(line.querySelector('.chat-author small')).toBeNull()
    expect(line.querySelector('strong')?.textContent).toBe('Ghost')
    expect(line.querySelector('strong')?.getAttribute('class')).toBeNull()
    expect(line.textContent).toContain('Still here')
  })

  it('shows no civ text while the civilization is not revealed, but keeps the colour', async () => {
    const container = await renderChat(new Map([['Alice', { civilization: null, color: 'Red' }]]))
    const line = Array.from(container.querySelectorAll('li')).find((li) => li.textContent?.includes('Alice'))
    expect(line?.querySelector('small')).toBeNull()
    expect(line?.querySelector('strong')?.className).toBe('player-red')
  })

  it('renders without an authors lookup at all', async () => {
    chat.mockResolvedValue(messages)
    await act(async () => {
      render(<ChatPanel gameId="game" busy={false} run={async () => {}} player={player} reloadCount={0} autoRefresh={false} />)
    })
    expect(screen.getByText('Alice')).toBeTruthy()
  })
})
