// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { LogEntryDto, PlayerView } from '../lib/api.js'
import { LogPanel } from './LogPanel.js'

beforeEach(() => localStorage.setItem('civ.panel.log', 'true'))
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.log')
  vi.restoreAllMocks()
})

const entry = (id: string, message: string, extra: Partial<LogEntryDto> = {}): LogEntryDto => ({
  id,
  username: 'Alice',
  logType: null,
  message,
  hasUndo: false,
  ...extra,
})

const run = async (action: () => Promise<PlayerView | unknown>): Promise<void> => {
  await action()
}

function renderLog(publicLog: readonly LogEntryDto[], privateLog: readonly LogEntryDto[] = []) {
  vi.spyOn(api, 'publicLog').mockResolvedValue([...publicLog])
  vi.spyOn(api, 'privateLog').mockResolvedValue([...privateLog])
  vi.spyOn(api, 'pendingUndos').mockResolvedValue([])
  return render(<LogPanel gameId="game-1" busy={false} run={run} reloadCount={0} />)
}

describe('LogPanel undo on the public tab', () => {
  it('offers Ask for undo on a public line the server marks canUndo, and asks through the existing vote', async () => {
    const ask = vi.spyOn(api, 'initiateUndo').mockResolvedValue({} as PlayerView)
    renderLog([
      entry('line-1', 'Alice used Chivalry: spent 1 Incense and gained 5 culture', {
        assistedActionId: 'req-1',
        canUndo: true,
      }),
    ])

    fireEvent.click(await screen.findByRole('button', { name: 'Ask for undo' }))

    await waitFor(() => expect(ask).toHaveBeenCalledWith('game-1', 'line-1'))
  })

  it('offers no button on public lines the server did not mark, or that are already undone', async () => {
    renderLog([
      entry('line-1', 'Alice drew a card'),
      entry('line-2', "Alice's Chivalry was undone", { assistedActionId: 'req-1', canUndo: false }),
    ])

    await screen.findByText('Alice drew a card')

    expect(screen.queryByRole('button', { name: 'Ask for undo' })).toBeNull()
  })

  it('keeps the private tab as it was: the button there still follows canUndo', async () => {
    renderLog([], [entry('private-1', 'Alice drew Pottery', { canUndo: true })])

    fireEvent.click(screen.getByRole('button', { name: 'Private' }))

    expect(await screen.findByRole('button', { name: 'Ask for undo' })).toBeTruthy()
  })

  it('disables the button while another write runs', async () => {
    vi.spyOn(api, 'publicLog').mockResolvedValue([
      entry('line-1', 'Alice used Chivalry', { assistedActionId: 'req-1', canUndo: true }),
    ])
    vi.spyOn(api, 'privateLog').mockResolvedValue([])
    vi.spyOn(api, 'pendingUndos').mockResolvedValue([])
    render(<LogPanel gameId="game-1" busy={true} run={run} reloadCount={0} />)

    const button = (await screen.findByRole('button', { name: 'Ask for undo' })) as HTMLButtonElement

    expect(button.disabled).toBe(true)
  })
})
