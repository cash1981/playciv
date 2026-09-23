// @vitest-environment jsdom

import { highscore } from '@civ/engine'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import { HighscoreView } from './HighscoreView.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('sorts the player rating column numerically', async () => {
  const score = highscore([
    { numOfPlayers: 2, winner: 'Alice', players: [{ username: 'Alice', civName: null }, { username: 'Bob', civName: null }] },
  ], ['Alice', 'Bob'])
  vi.spyOn(api, 'highscore').mockResolvedValue({ ...score, ratings: [
    { username: 'Alice', rating: 9.5, uncertainty: 2, games: 1 },
    { username: 'Bob', rating: 10.25, uncertainty: 2, games: 1 },
  ] })
  render(<HighscoreView />)
  await screen.findByRole('button', { name: /rating/i })
  fireEvent.click(screen.getByRole('button', { name: /rating/i }))
  const names = Array.from(document.querySelectorAll('tbody tr td:first-child')).map((cell) => cell.textContent)
  expect(names).toEqual(['Bob', 'Alice'])
})

it('displays rating as rounded points on a 100-times scale, including negative values', async () => {
  const score = highscore([
    { numOfPlayers: 2, winner: 'Alice', players: [{ username: 'Alice', civName: null }, { username: 'Bob', civName: null }] },
  ], ['Alice', 'Bob'])
  vi.spyOn(api, 'highscore').mockResolvedValue({ ...score, ratings: [
    { username: 'Alice', rating: 26.62, uncertainty: 2, games: 1 },
    { username: 'Bob', rating: -1.23, uncertainty: 2, games: 1 },
  ] })
  render(<HighscoreView />)
  expect(await screen.findByText('2662')).toBeTruthy()
  expect(screen.getByText('-123')).toBeTruthy()
})
