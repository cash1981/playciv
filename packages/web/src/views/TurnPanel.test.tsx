import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlayerTurn, TurnPhase } from '@civ/engine'

import {
  PrivateLogWorkspace,
  TurnOrderWorkspace,
  TurnTabs,
} from './TurnPanel.js'

const orders: Readonly<Record<TurnPhase, string>> = {
  SOT: '**Build** a city',
  TRADE: 'Trade with blue',
  CM: 'Produce infantry',
  MOVEMENT: 'Move north',
  RESEARCH: 'Research writing',
}

const history: Readonly<Record<TurnPhase, readonly string[]>> = {
  SOT: [],
  TRADE: [],
  CM: [],
  MOVEMENT: [],
  RESEARCH: [],
}

const turn = (username: string, disabled = false): PlayerTurn => ({
  turnNumber: 3,
  username,
  disabled,
  orders,
  history,
})

const noop = (): void => undefined
const run = async (): Promise<void> => undefined

describe('TurnPanel player tabs', () => {
  it('labels every player tab with its username and colour, followed by Private log', () => {
    const markup = renderToStaticMarkup(
      <TurnTabs
        players={[
          { username: 'cash1981', color: 'Red', own: true },
          { username: 'Andrius', color: 'Blue', own: false },
        ]}
        selectedUsername="cash1981"
        privateLogSelected={false}
        showPrivateLog={true}
        onSelectPlayer={noop}
        onSelectPrivateLog={noop}
      />,
    )

    expect(markup).toContain('cash1981')
    expect(markup).toContain('Andrius')
    expect(markup).toContain('Private log')
    expect(markup).toContain('--turn-tab-color:red')
    expect(markup).toContain('--turn-tab-color:blue')
    expect(markup.indexOf('Private log')).toBeGreaterThan(markup.indexOf('Andrius'))
  })
})

describe('TurnOrderWorkspace', () => {
  it('gives the signed-in player five editable Markdown editors and order actions', () => {
    const markup = renderToStaticMarkup(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        player={{ username: 'cash1981', color: 'Red', own: true }}
        turnNumber={3}
        turnNumbers={[1, 2, 3]}
        current={turn('cash1981')}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
      />,
    )

    expect(markup.match(/data-readonly="false"/g)).toHaveLength(5)
    expect(markup.match(/Save /g)).toHaveLength(5)
    expect(markup).toContain('New turn')
    expect(markup).toContain('Lock the turn')
    expect(markup).not.toContain('All orders')
  })

  it('renders another player orders read-only without publishing controls', () => {
    const markup = renderToStaticMarkup(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        player={{ username: 'Andrius', color: 'Blue', own: false }}
        turnNumber={3}
        turnNumbers={[3]}
        current={turn('Andrius')}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
      />,
    )

    expect(markup.match(/data-readonly="true"/g)).toHaveLength(5)
    expect(markup).toContain('orders for Andrius, turn 3')
    expect(markup).not.toContain('New turn')
    expect(markup).not.toContain('Lock the turn')
    expect(markup).not.toContain('Save start of turn')
  })

  it('keeps a locked own turn read-only while offering Reopen', () => {
    const markup = renderToStaticMarkup(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        player={{ username: 'cash1981', color: 'Red', own: true }}
        turnNumber={3}
        turnNumbers={[3]}
        current={turn('cash1981', true)}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
      />,
    )

    expect(markup.match(/data-readonly="true"/g)).toHaveLength(5)
    expect(markup).toContain('Reopen')
    expect(markup).toContain('Save start of turn')
    expect(markup).toContain('disabled=""')
  })
})

describe('PrivateLogWorkspace', () => {
  it('describes the note as private and saves it explicitly', () => {
    const markup = renderToStaticMarkup(
      <PrivateLogWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        note="Plan the next research choice"
        dirty={true}
        onChange={noop}
        onSaved={noop}
      />,
    )

    expect(markup).toContain('Only you can see this planning space')
    expect(markup).toContain('does not add an entry to the game log')
    expect(markup).toContain('Save private log')
    expect(markup).toContain('aria-label="Private log"')
    expect(markup).not.toContain('Publish')
  })
})
