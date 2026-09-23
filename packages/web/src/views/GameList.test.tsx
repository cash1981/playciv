// @vitest-environment jsdom

/**
 * The front page's game list: the old list.html tabs (Active games / Finished
 * games), the search box and "Show my games", a sortable table on each tab, and
 * ten rows per page.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlayerDto, PublicGameSummary } from '../lib/api.js'
import { GameList } from './GameList.js'

const player: PlayerDto = {
  id: 'player-cash1981',
  username: 'cash1981',
  email: null,
  role: 'user',
  disabled: false,
}

const noop = (): void => undefined

function game(
  overrides: Partial<PublicGameSummary> & { readonly id: string; readonly name: string },
): PublicGameSummary {
  return {
    gameType: 'WAW',
    createdAt: '2026-09-18T07:08:09.000Z',
    numOfPlayers: 4,
    active: true,
    winner: null,
    players: [{ username: 'cash1981', color: 'Red' }],
    nameOfUsersTurn: '',
    youAreIn: false,
    availableColors: ['Green', 'Yellow', 'Purple', 'Red', 'Blue'],
    ...overrides,
  }
}

/**
 * The Name cell of every body row, in render order. The Name renders as the
 * row's only link, so this works whichever tab is open — the two tabs now
 * order their columns differently (the active table leads with Action).
 */
function names(): (string | null)[] {
  return Array.from(document.querySelectorAll('tbody tr td a')).map((link) => link.textContent)
}

/** The currently rendered table's header text, in order, with any sort arrow stripped. */
function headers(): (string | null)[] {
  return Array.from(document.querySelectorAll('thead th')).map(
    (th) => th.textContent?.replace(/[▲▼]/g, '') ?? null,
  )
}

afterEach(cleanup)

describe('GameList', () => {
  it('splits the games across the active and finished tabs', () => {
    const games = [
      game({ id: 'active-1', name: 'Alpha' }),
      game({ id: 'finished-1', name: 'Beta', active: false, winner: 'cash1981' }),
    ]

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    // Active is selected first, and only its games show.
    expect(screen.getByRole('button', { name: 'Active games' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(names()).toEqual(['Alpha'])

    fireEvent.click(screen.getByRole('button', { name: 'Finished games' }))
    expect(names()).toEqual(['Beta'])
    expect(screen.getByText('Total number of games finished: 1')).toBeTruthy()
  })

  it('filters on the game name, the type and a player username', () => {
    const games = [
      game({ id: 'a', name: 'Alpha', gameType: 'WAW' }),
      // A different type string so the type search has something to exclude;
      // the real engine only ships WAW, but the field is a plain string.
      game({
        id: 'b',
        name: 'Beta',
        gameType: 'FAF',
        players: [{ username: 'Andrius', color: 'Blue' }],
      }),
    ]

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    fireEvent.change(screen.getByLabelText('Search games'), { target: { value: 'andri' } })
    expect(names()).toEqual(['Beta'])

    fireEvent.change(screen.getByLabelText('Search games'), { target: { value: 'waw' } })
    expect(names()).toEqual(['Alpha'])
  })

  it('keeps only games the player is in, and hides the checkbox when signed out', () => {
    const games = [
      game({ id: 'mine', name: 'Mine', youAreIn: true }),
      game({ id: 'other', name: 'Other' }),
    ]

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    expect(names()).toEqual(['Mine', 'Other'])
    fireEvent.click(screen.getByLabelText('Show my games'))
    expect(names()).toEqual(['Mine'])

    cleanup()
    render(
      <GameList games={games} player={null} busy={false} onOpenGame={noop} onJoin={noop} />,
    )
    expect(screen.queryByLabelText('Show my games')).toBeNull()
  })

  it('clears "Show my games" when the player signs out', () => {
    const games = [
      game({ id: 'mine', name: 'Mine', youAreIn: true }),
      game({ id: 'other', name: 'Other' }),
    ]

    const { rerender } = render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )
    fireEvent.click(screen.getByLabelText('Show my games'))
    expect(names()).toEqual(['Mine'])

    rerender(<GameList games={games} player={null} busy={false} onOpenGame={noop} onJoin={noop} />)

    // The filter is cleared with the control, so the list is not left
    // silently filtered with no way back.
    expect(screen.queryByLabelText('Show my games')).toBeNull()
    expect(names()).toEqual(['Mine', 'Other'])
  })

  it('pages ten active games at a time', () => {
    const games = Array.from({ length: 12 }, (_, index) =>
      game({ id: `game-${index}`, name: `Game ${String(index).padStart(2, '0')}` }),
    )

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    expect(document.querySelectorAll('tbody tr')).toHaveLength(10)
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  })

  it('sorts when a column header is clicked', () => {
    const games = [
      game({ id: 'a', name: 'Alpha', numOfPlayers: 2 }),
      game({ id: 'b', name: 'Beta', numOfPlayers: 5 }),
      game({ id: 'c', name: 'Gamma', numOfPlayers: 3 }),
    ]

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    // Both tables open sorted by Name ascending, the order the server returns.
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma'])

    // Number of players is numeric, so it opens descending.
    fireEvent.click(screen.getByRole('button', { name: /number of players/i }))
    expect(names()).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('shows an empty Created cell for a game saved before the field existed', () => {
    const games = [game({ id: 'old', name: 'Old game', createdAt: null })]

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    // Action, #, Created, Name, Type, Number of players, Players.
    const cells = Array.from(document.querySelectorAll('tbody tr td'))
    expect(cells[2]?.textContent).toBe('')
  })

  it('puts the Action column first on the active tab and omits it on finished', () => {
    const games = [
      game({ id: 'mine', name: 'Mine', youAreIn: true }),
      game({ id: 'done', name: 'Done', active: false, winner: 'cash1981' }),
    ]

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    // The active table leads with the action, so its buttons are reachable on a
    // narrow screen without scrolling sideways.
    expect(headers()).toEqual([
      'Action',
      '#',
      'Created',
      'Name',
      'Type',
      'Number of players',
      'Players',
    ])
    expect(document.querySelector('tbody tr td')?.textContent).toBe('Open')

    fireEvent.click(screen.getByRole('button', { name: 'Finished games' }))

    // A finished game has nothing to open or join, so the column is gone and
    // the old order stands.
    expect(headers()).toEqual([
      '#',
      'Created',
      'Name',
      'Type',
      'Number of players',
      'Players',
    ])
  })

  it('colours Open teal and Join green, and leaves Full plain', () => {
    const games = [
      game({ id: 'mine', name: 'Mine', youAreIn: true }),
      game({
        id: 'joinable',
        name: 'Joinable',
        players: [{ username: 'Andrius', color: 'Blue' }],
      }),
      game({
        id: 'full',
        name: 'Full',
        numOfPlayers: 2,
        players: [
          { username: 'Andrius', color: 'Blue' },
          { username: 'Someone', color: 'Red' },
        ],
      }),
    ]

    render(
      <GameList games={games} player={player} busy={false} onOpenGame={noop} onJoin={noop} />,
    )

    // Open is the old `btn-info` teal; Join is the green the human asked for.
    expect(screen.getByRole('button', { name: 'Open' }).className).toContain('info')
    expect(screen.getByRole('button', { name: 'Join' }).className).toContain('success')
    // A non-action: no colour, and it cannot be clicked anyway.
    const full = screen.getByRole('button', { name: 'Full' })
    expect(full.className).not.toContain('info')
    expect(full.className).not.toContain('success')
  })

  it('shows only available colors and submits the selected join color', () => {
    const onJoin = vi.fn()
    render(
      <GameList
        games={[game({ id: 'joinable', name: 'Joinable', availableColors: ['Purple', 'Blue'] })]}
        player={player}
        busy={false}
        onOpenGame={noop}
        onJoin={onJoin}
      />,
    )
    const select = screen.getByLabelText('Color for Joinable') as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['Purple', 'Blue'])
    expect(select.value).toBe('Purple')
    fireEvent.change(select, { target: { value: 'Blue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(onJoin).toHaveBeenCalledWith('joinable', 'Blue')
  })

  it('keeps the game list and action controls in the mobile layout hooks', () => {
    render(
      <GameList
        games={[game({ id: 'joinable', name: 'Joinable' })]}
        player={player}
        busy={false}
        onOpenGame={noop}
        onJoin={noop}
      />,
    )

    expect(document.querySelector('.game-list')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join' }).className).toContain('small')
  })
})
