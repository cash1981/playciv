// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '@civ/engine'

import { api } from '../lib/api.js'
import type { GameRevisionSummary, PlayerView } from '../lib/api.js'
import {
  AUTO_REFRESH_MS,
  HandItem,
  loadAfterKnownRevision,
  PrimaryPanelOrder,
  reloadIfRevisionChanged,
} from './GameView.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The reload only reads `rev`, so the rest of the view is irrelevant here. */
const viewAt = (rev: number): PlayerView => ({ rev }) as unknown as PlayerView

const revisionsUpTo = (revision: number): readonly GameRevisionSummary[] =>
  [{ revision }] as unknown as readonly GameRevisionSummary[]

describe('game auto-refresh', () => {
  // The human asked for 10 s specifically ("setter auto refresh til 10
  // sekunder"); the toggle was introduced at 30 s (issue #63). This fails if
  // the interval is changed back without a decision.
  it('checks the live game every 10 seconds', () => {
    expect(AUTO_REFRESH_MS).toBe(10_000)
  })

  it('checks only the marker and skips a full reload when unchanged', async () => {
    const readRevision = vi.fn(async () => 7)
    const reload = vi.fn(async () => true)
    expect(await reloadIfRevisionChanged(readRevision, () => 7, reload)).toBe(false)
    expect(readRevision).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads after the marker changes', async () => {
    const reload = vi.fn(async () => true)
    expect(await reloadIfRevisionChanged(async () => 8, () => 7, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('loadAfterKnownRevision', () => {
  it('skips the revision list when the live revision has not moved', async () => {
    const loadRevisions = vi.fn(async () => revisionsUpTo(7))
    const loadView = vi.fn(async () => viewAt(7))

    const result = await loadAfterKnownRevision(loadRevisions, loadView, 7)

    expect(result.revisions).toBeNull()
    expect(loadRevisions).not.toHaveBeenCalled()
    expect(loadView).toHaveBeenCalledTimes(1)
  })

  it('reads the consistent history pair when the live revision has moved', async () => {
    const revisions = revisionsUpTo(8)
    const loadRevisions = vi.fn(async () => revisions)
    const loadView = vi.fn(async () => viewAt(8))

    const result = await loadAfterKnownRevision(loadRevisions, loadView, 7)

    expect(result.revisions).toBe(revisions)
    expect(loadRevisions).toHaveBeenCalledTimes(1)
    // History is read first (#70), so the view is read a second time here.
    expect(loadView).toHaveBeenCalledTimes(2)
  })

  it('still pairs a revision that moved without a new revision, like a private note', async () => {
    // A private note advances `rev` but writes no revision, so the newest
    // revision is older than the view. The pair must still be accepted.
    const revisions = revisionsUpTo(3)
    const loadRevisions = vi.fn(async () => revisions)
    const loadView = vi.fn(async () => viewAt(4))

    const result = await loadAfterKnownRevision(loadRevisions, loadView, 3)

    expect(result.revisions).toBe(revisions)
    expect(loadRevisions).toHaveBeenCalledTimes(1)
  })
})

const base = {
  itemNumber: 1,
  description: null,
  used: false,
  hidden: true,
  ownerId: 'player-me',
  type: null,
} as const

const run = async (action: () => Promise<unknown>): Promise<void> => {
  await action()
}

describe('primary game panel order', () => {
  it('shows Draw before the responsive Log and Chat pair', () => {
    const { container } = render(
      <PrimaryPanelOrder
        draw={<section aria-label="Draw" />}
        log={<section aria-label="Log" />}
        chat={<section aria-label="Chat" />}
      />,
    )

    expect(
      Array.from(container.querySelectorAll('section'), (panel) => panel.getAttribute('aria-label')),
    ).toEqual(['Draw', 'Log', 'Chat'])
    expect(
      Array.from(container.querySelector('.panel-pair')?.children ?? [], (panel) =>
        panel.getAttribute('aria-label'),
      ),
    ).toEqual(['Log', 'Chat'])
  })
})

/**
 * New in this port — see the pyramid-reposition task brief. "Place in tech
 * pyramid" must appear only for Sir Isaac Newton, by exact name match, never
 * for any other Great Person.
 */
describe('HandItem: place a Great Person in the tech pyramid (#168 follow-up)', () => {
  const newton: Item = {
    ...base,
    id: 'gp-newton',
    sheetName: 'GREAT_PERSON',
    kind: 'greatperson',
    name: 'Sir Isaac Newton',
    type: 'Scientist',
  }

  const otherGreatPerson: Item = {
    ...base,
    id: 'gp-other',
    sheetName: 'GREAT_PERSON',
    kind: 'greatperson',
    name: 'Louis Pasteur',
    type: 'Scientist',
  }

  it('shows the control only for Sir Isaac Newton, by exact name match', () => {
    const { unmount } = render(
      <HandItem item={newton} gameId="g" busy={false} run={run} opponents={[]} />,
    )
    expect(screen.getByRole('button', { name: 'Place in tech pyramid' })).toBeTruthy()
    unmount()

    render(<HandItem item={otherGreatPerson} gameId="g" busy={false} run={run} opponents={[]} />)
    expect(screen.queryByRole('button', { name: 'Place in tech pyramid' })).toBeNull()
  })

  it('calls placeGreatPersonInPyramid with the item id and the chosen row', () => {
    const place = vi.spyOn(api, 'placeGreatPersonInPyramid').mockResolvedValue({} as PlayerView)
    render(<HandItem item={newton} gameId="game-1" busy={false} run={run} opponents={[]} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Pyramid row for Sir Isaac Newton' }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Place in tech pyramid' }))

    expect(place).toHaveBeenCalledWith('game-1', 'gp-newton', 3)
  })

  it('defaults the chosen row to 1', () => {
    const place = vi.spyOn(api, 'placeGreatPersonInPyramid').mockResolvedValue({} as PlayerView)
    render(<HandItem item={newton} gameId="game-1" busy={false} run={run} opponents={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Place in tech pyramid' }))

    expect(place).toHaveBeenCalledWith('game-1', 'gp-newton', 1)
  })
})
