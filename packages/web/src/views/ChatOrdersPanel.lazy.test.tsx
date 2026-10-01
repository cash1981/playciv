// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { ChatOrdersPanel } from './ChatOrdersPanel.js'

// The Markdown chunk fails to load, as it does after a deploy replaced it or on a
// flaky connection. The import throws when the lazy component first asks for it.
vi.mock('./SafeMarkdown.js', () => {
  throw new Error('chunk failed to load')
})

vi.mock('../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.js')>()),
  api: { chatPage: vi.fn() },
}))

afterEach(cleanup)

describe('when the Markdown chunk cannot be loaded', () => {
  it('shows the message as plain text instead of blanking the page', async () => {
    vi.mocked(api.chatPage).mockResolvedValue({
      messages: [
        {
          id: 'm1',
          username: 'Bob',
          message: '**Build** a <b>Library</b>',
          createdAt: '2026-01-01T10:00:00.000Z',
          kind: 'chat',
          turnNumber: null,
          phase: null,
        },
      ],
      hasMore: false,
    })
    const view = { chatOrders: true, you: null, opponents: [], activeTurn: null } as unknown as PlayerView
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      render(
        <ChatOrdersPanel
          gameId="game"
          view={view}
          busy={false}
          readOnly
          run={async (action) => { await action() }}
          reloadCount={0}
          autoRefresh={false}
        />,
      )
    })
    // Let the rejected import settle
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

    // The text is on the page as text, not as markup, and the panel is still there
    const plain = screen.getByText('**Build** a <b>Library</b>')
    expect(plain.className).toContain('chat-orders-plain')
    expect(plain.querySelector('b')).toBeNull()
    expect(screen.getByText('Bob')).not.toBeNull()
    consoleError.mockRestore()
  })
})
