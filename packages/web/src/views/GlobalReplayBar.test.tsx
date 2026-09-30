// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { GameRevisionSummary } from '../lib/api.js'
import { GlobalReplayBar } from './GameView.js'

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
})
