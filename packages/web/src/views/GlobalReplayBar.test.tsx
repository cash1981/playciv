// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { GameRevisionSummary } from '../lib/api.js'
import { GlobalReplayBar, winnerOnlyLine } from './GameView.js'

afterEach(cleanup)

describe('GlobalReplayBar', () => {
  it('names what was done the way the public log does', () => {
    const { container } = render(
      <GlobalReplayBar
        revisions={[
          {
            // An older server still sent the viewer's private line too
            privateDescription: 'cash1981 has researched - Tech: Navy',
            gameId: 'game-1',
            revision: 3,
            createdAt: '2026-09-30T10:00:00Z',
            actor: { playerId: 'p1', username: 'cash1981' },
            publicDescription: 'cash1981 has researched a hidden technology. Item number #1234567',
            logIds: ['log-1'],
          } as unknown as GameRevisionSummary,
        ]}
        selectedRevision={null}
        busy={false}
        onRevision={() => undefined}
        onLive={() => undefined}
      />,
    )

    expect(container.textContent).toContain('has researched a hidden technology')
    expect(container.textContent).toContain('cash1981')
    expect(container.textContent).not.toContain('Navy')
  })

  const revisionNamed = (publicDescription: string, username = 'admin'): GameRevisionSummary =>
    ({
      gameId: 'game-1',
      revision: 9,
      createdAt: '2026-09-30T10:00:00Z',
      actor: { playerId: 'p9', username },
      publicDescription,
      logIds: [],
    }) as unknown as GameRevisionSummary

  const barText = (revision: GameRevisionSummary): string => {
    const { container } = render(
      <GlobalReplayBar
        revisions={[revision]}
        selectedRevision={null}
        busy={false}
        onRevision={() => undefined}
        onLive={() => undefined}
      />,
    )
    return container.querySelector('.replay-what')?.textContent ?? ''
  }

  it('shows only who won on the winner revision, not the admin who ended the game', () => {
    const text = barText(revisionNamed('cash won the game! Congratulations!', 'admin'))
    expect(text).toBe('cash won the game! Congratulations!')
    expect(text).not.toContain('admin')
    expect(text).not.toContain('—')
  })

  it('shows only the winner on a revision stored with the joined winner and ended lines', () => {
    const text = barText(
      revisionNamed('System: cash won the game! Congratulations! · System: admin Ended this game', 'admin'),
    )
    expect(text).toBe('cash won the game! Congratulations!')
    expect(text).not.toContain('System')
    expect(text).not.toContain('admin')
    expect(text).not.toContain('—')
  })

  it('keeps the actor when the winner text merely ends the description', () => {
    expect(barText(revisionNamed('Ended this game · cash won the game! Congratulations!', 'admin'))).toBe(
      'Ended this game · cash won the game! Congratulations! — admin',
    )
  })

  it('still names the actor on every other revision, including one that merely mentions winning', () => {
    expect(barText(revisionNamed('cash has researched a hidden technology.', 'cash'))).toBe(
      'cash has researched a hidden technology. — cash',
    )
    cleanup()
    expect(barText(revisionNamed('Ended this game', 'admin'))).toBe('Ended this game — admin')
  })
})

describe('winnerOnlyLine', () => {
  it('matches the winner line the server writes and nothing looser', () => {
    expect(winnerOnlyLine('cash won the game! Congratulations!')).not.toBeNull()
    expect(winnerOnlyLine('Ola Nordmann won the game! Congratulations!')).not.toBeNull()
    expect(winnerOnlyLine('cash won the game')).toBeNull()
    expect(winnerOnlyLine(' won the game! Congratulations!')).toBeNull()
    expect(winnerOnlyLine('cash won the game! Congratulations! Extra')).toBeNull()
    expect(winnerOnlyLine('')).toBeNull()
  })

  it('also matches the stored joined form, but not a description that only ends with the winner text', () => {
    expect(winnerOnlyLine('System: cash won the game! Congratulations! · System: admin Ended this game')).toBe(
      'cash won the game! Congratulations!',
    )
    expect(winnerOnlyLine('cash won the game! Congratulations!')).toBe('cash won the game! Congratulations!')
    expect(winnerOnlyLine('Ended this game · cash won the game! Congratulations!')).toBeNull()
    expect(winnerOnlyLine('System: admin Ended this game · System: cash won the game! Congratulations!')).toBeNull()
    expect(winnerOnlyLine('cash won the game! Congratulations! · System: admin Ended this game extra')).toBeNull()
  })
})
