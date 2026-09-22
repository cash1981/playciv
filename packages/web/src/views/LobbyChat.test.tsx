// @vitest-environment jsdom

/**
 * The front page's lobby chat panel: the server returns messages newest first,
 * the shared `Pager` shows ten at a time, and the send form hands the trimmed
 * text to `onSend` and then clears.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessageDto, PlayerDto } from '../lib/api.js'
import { LobbyChat } from './LobbyChat.js'

const player: PlayerDto = {
  id: 'player-cash1981',
  username: 'cash1981',
  email: null,
  role: 'user',
  disabled: false,
}

/** Newest first, like the server: index 0 is the most recent. */
function messages(count: number): readonly ChatMessageDto[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    username: 'cash1981',
    message: `message ${String(index).padStart(2, '0')}`,
    createdAt: new Date(Date.UTC(2026, 8, 20, 10, 0, 59 - index)).toISOString(),
  }))
}

afterEach(cleanup)

describe('LobbyChat', () => {
  it('renders the newest message first', () => {
    render(
      <LobbyChat messages={messages(3)} player={player} busy={false} onSend={async () => {}} />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]?.textContent).toContain('message 00')
    expect(items[2]?.textContent).toContain('message 02')
  })

  it('pages ten at a time with a working Prev/Next', () => {
    render(
      <LobbyChat messages={messages(12)} player={player} busy={false} onSend={async () => {}} />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
  })

  it('sends the trimmed text and clears the input', async () => {
    const onSend = vi.fn(async (_message: string): Promise<void> => {})
    render(<LobbyChat messages={messages(0)} player={player} busy={false} onSend={onSend} />)

    const input = screen.getByLabelText('Lobby chat message') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  hello there  ' } })
    const form = input.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    expect(onSend).toHaveBeenCalledWith('hello there')
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('keeps the send form in the mobile layout hook', () => {
    render(<LobbyChat messages={messages(0)} player={player} busy={false} onSend={async () => {}} />)

    expect(screen.getByLabelText('Lobby chat message').closest('form')?.className).toContain(
      'lobby-chat-form',
    )
  })

  it('returns to page 1 after a send', async () => {
    const onSend = vi.fn(async (_message: string): Promise<void> => {})
    render(<LobbyChat messages={messages(12)} player={player} busy={false} onSend={onSend} />)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()

    const input = screen.getByLabelText('Lobby chat message') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'back to the top' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeTruthy())
  })

  it('a signed-out visitor sees a note instead of the send form', () => {
    render(
      <LobbyChat messages={messages(0)} player={null} busy={false} onSend={async () => {}} />,
    )

    expect(screen.getByText('Sign in to join the conversation.')).toBeTruthy()
    expect(screen.queryByLabelText('Lobby chat message')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })
})
