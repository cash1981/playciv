// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlayerDto } from '../lib/api.js'
import { LandingView } from './LandingView.js'

const apiMocks = vi.hoisted(() => ({
  publicGames: vi.fn(async () => []),
  lobbyChat: vi.fn(async () => []),
  highscore: vi.fn(async () => ({ players: [] })),
  createGame: vi.fn(async () => ({ id: 'created' })),
}))

vi.mock('../lib/api.js', () => ({ api: apiMocks }))
vi.mock('./GameList.js', () => ({ GameList: () => null }))
vi.mock('./HighscoreView.js', () => ({ HighscoreView: () => null }))
vi.mock('./LobbyChat.js', () => ({ LobbyChat: () => null }))

const player: PlayerDto = {
  id: 'creator', username: 'Creator', email: null, role: 'user', disabled: false,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LandingView', () => {
  it('shows the selected creator color and submits it with the game', async () => {
    render(<LandingView player={player} onOpenGame={() => {}} onSignIn={() => {}} />)
    const color = screen.getByLabelText('Player color') as HTMLSelectElement
    expect(Array.from(color.options).map((option) => option.value)).toEqual([
      'Green', 'Yellow', 'Purple', 'Red', 'Blue',
    ])
    fireEvent.change(color, { target: { value: 'Red' } })
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'My game' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(apiMocks.createGame).toHaveBeenCalledWith('My game', 4, 'Red'))
  })
})
