import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { findBoardAsset } from '@civ/engine'
import type { BoardPiece } from '@civ/engine'

import { BoardPalette } from './BoardView.js'

const piece = (assetId: string, id: string): BoardPiece => ({
  id,
  assetId,
  path: 'buildings/academy.png',
  label: 'Academy',
  category: 'building',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  rotation: 0,
  placedBy: null,
})

describe('BoardPalette finite supplies', () => {
  it('shows the remaining count and disables an exhausted building family', () => {
    const academy = findBoardAsset('buildings/academy')
    if (academy === undefined) throw new Error('academy missing from manifest')

    const exhausted = renderToStaticMarkup(
      <BoardPalette
        assets={[academy]}
        category="building"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={Array.from({ length: 6 }, (_, index) => piece('buildings/barracks', String(index)))}
        numOfPlayers={4}
      />,
    )
    expect(exhausted).toContain('Academy (0)')
    expect(exhausted).toContain('draggable="false"')

    const restored = renderToStaticMarkup(
      <BoardPalette
        assets={[academy]}
        category="building"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={Array.from({ length: 5 }, (_, index) => piece('buildings/barracks', String(index)))}
        numOfPlayers={4}
      />,
    )
    expect(restored).toContain('Academy (1)')
    expect(restored).toContain('draggable="true"')
  })
})
