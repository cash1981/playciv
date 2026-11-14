// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useIsBusy } from '../lib/activity.js'
import type { PlayerDto } from '../lib/api.js'
import { LandingView } from './LandingView.js'

const apiMocks = vi.hoisted(() => ({
  publicGames: vi.fn(async () => []),
  lobbyChat: vi.fn(async () => []),
  highscore: vi.fn(async () => ({ players: [] })),
  createGame: vi.fn(async () => ({ id: 'created' })),
  searchPlayers: vi.fn(async (query: string) =>
    ['anna', 'annika', 'bob'].filter((name) => name.includes(query)).map((username) => ({ username }))),
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

  it('creates a private game with invitees chosen from the autocomplete (issue #348)', async () => {
    render(<LandingView player={player} onOpenGame={() => {}} onSignIn={() => {}} />)
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Secret' } })
    fireEvent.change(screen.getByLabelText('Number of players'), { target: { value: '3' } })
    expect(screen.queryByLabelText('Invite player')).toBeNull()
    fireEvent.click(screen.getByLabelText('Private game'))
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)

    const input = screen.getByLabelText('Invite player')
    fireEvent.change(input, { target: { value: 'ann' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'annika' }))
    expect(screen.getByRole('button', { name: 'Remove annika' })).toBeTruthy()

    fireEvent.change(input, { target: { value: 'bo' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'bob' }))

    // Two of two seats are chosen, so the field closes. Removing a chip reopens it.
    expect((input as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove bob' }))
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)

    // A chosen name is not offered again.
    fireEvent.change(input, { target: { value: 'ann' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'anna' }))
    expect(screen.queryByRole('option', { name: 'annika' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(apiMocks.createGame).toHaveBeenCalledWith('Secret', 3, 'Green', ['annika', 'anna']),
    )
  })

  it('stops offering names once every invite seat is taken', async () => {
    render(<LandingView player={player} onOpenGame={() => {}} onSignIn={() => {}} />)
    fireEvent.change(screen.getByLabelText('Number of players'), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText('Private game'))
    fireEvent.change(screen.getByLabelText('Invite player'), { target: { value: 'bo' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'bob' }))
    expect((screen.getByLabelText('Invite player') as HTMLInputElement).disabled).toBe(true)
  })

  it('keeps the global spinner busy through the reload after a write (issue #225)', async () => {
    render(<LandingView player={player} onOpenGame={() => {}} onSignIn={() => {}} />)
    await waitFor(() => expect(apiMocks.publicGames).toHaveBeenCalled())
    const busy = renderHook(() => useIsBusy())

    // The write is instant; the reload that follows it is the slow part.
    let finishReload: (games: never[]) => void = () => {}
    apiMocks.publicGames.mockImplementationOnce(
      () => new Promise<never[]>((resolve) => { finishReload = resolve }),
    )
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Slow game' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(apiMocks.createGame).toHaveBeenCalled())
    await waitFor(() => expect(busy.result.current).toBe(true))

    await act(async () => { finishReload([]) })
    await waitFor(() => expect(busy.result.current).toBe(false))
  })
})
