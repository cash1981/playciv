import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ArenaUnit } from '@civ/engine'
import { ArenaUnitCard } from './GameView.js'

const card: ArenaUnit['unit'] = {
  kind: 'artillery',
  sheetName: 'ARTILLERY',
  id: 'unit-1',
  itemNumber: 43,
  description: null,
  used: false,
  hidden: false,
  ownerId: 'player-cash1981',
  attack: 1,
  health: 3,
  level: 0,
  killed: false,
  inBattle: true,
}

function arenaUnit(overrides: Partial<ArenaUnit> = {}): ArenaUnit {
  return {
    id: 'arena-1',
    side: 'attacker',
    position: 0,
    unit: card,
    attack: 1,
    health: 3,
    placedBy: 'player-cash1981',
    rotation: 0,
    killed: false,
    arrival: null,
    ...overrides,
  }
}

const noop = () => undefined
const noopAsync = async () => undefined

describe('ArenaUnitCard', () => {
  it("faces the attacker's card upside down relative to a fresh (unrotated) defender's", () => {
    const attackerMarkup = renderToStaticMarkup(
      <ArenaUnitCard
        unit={arenaUnit({ side: 'attacker' })}
        gameId="game-1" busy={false} rev={0} run={noopAsync}
        canManage={false} canMove={false} onDragStart={noop} onDragEnd={noop}
      />,
    )
    const defenderMarkup = renderToStaticMarkup(
      <ArenaUnitCard
        unit={arenaUnit({ side: 'defender' })}
        gameId="game-1" busy={false} rev={0} run={noopAsync}
        canManage={false} canMove={false} onDragStart={noop} onDragEnd={noop}
      />,
    )

    // Base +180 for the attacker's row, 0 for the defender's — the two rows
    // face each other across the arena (issue #74), independent of any
    // level the player has rotated a given unit to.
    expect(attackerMarkup).toContain('transform:rotate(180deg)')
    expect(defenderMarkup).not.toContain('transform:rotate(')
  })

  it("adds the attacker's base rotation on top of the unit's own rotated level", () => {
    const markup = renderToStaticMarkup(
      <ArenaUnitCard
        unit={arenaUnit({ side: 'attacker', rotation: 90 })}
        gameId="game-1" busy={false} rev={0} run={noopAsync}
        canManage={false} canMove={false} onDragStart={noop} onDragEnd={noop}
      />,
    )
    // 90 (the unit's own rotation) + 180 (attacker base) = 270.
    expect(markup).toContain('transform:rotate(270deg)')
  })
  it('labels the card with the unit\'s tier, not its damaged or hand-edited values', () => {
    const render = (overrides: Partial<ArenaUnit>) =>
      renderToStaticMarkup(
        <ArenaUnitCard
          unit={arenaUnit(overrides)}
          gameId="game-1" busy={false} rev={0} run={noopAsync}
          canManage={false} canMove={false} onDragStart={noop} onDragEnd={noop}
        />,
      )
    // Printed 1.3, hurt down to 1.2: the label still says 1.3.
    expect(render({ health: 2 })).toContain('Artillery 1.3')
    expect(render({ health: 2 })).not.toContain('Artillery 1.2')
    // One rotate press lifts the tier to 2.4 whatever the HP field says.
    expect(render({ rotation: 270, attack: 2, health: 1 })).toContain('Artillery 2.4')
  })
})
