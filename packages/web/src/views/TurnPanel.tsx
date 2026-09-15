/**
 * Turn orders. Java: `TurnAction` and the turn tabs in old-civ-web.
 *
 * Orders are not hidden information — the whole point of play by forum is that
 * everyone reads each other's orders. Locking marks a turn as finished.
 */

import { useCallback, useEffect, useState } from 'react'

import { TURN_PHASES, TURN_PHASE_LABEL } from '@civ/engine'
import type { PlayerTurn, TurnPhase } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly reloadCount: number
}

export function TurnPanel({ gameId, busy, run, reloadCount }: Props): React.JSX.Element {
  const [turnNumber, setTurnNumber] = useState(1)
  const [mine, setMine] = useState<readonly PlayerTurn[]>([])
  const [publicTurns, setPublicTurns] = useState<readonly PlayerTurn[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [ours, theirs] = await Promise.all([api.myTurns(gameId), api.publicTurns(gameId)])
      setMine(ours)
      setPublicTurns(theirs)
      setLoadError(null)
    } catch (caught) {
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  const current = mine.find((turn) => turn.turnNumber === turnNumber)

  // Local drafts win over what is stored, so a fetch in the middle cannot
  // overwrite what you are typing
  const valueFor = (phase: TurnPhase): string =>
    drafts[`${turnNumber}:${phase}`] ?? current?.orders[phase] ?? ''

  const setDraft = (phase: TurnPhase, value: string): void =>
    setDrafts((existing) => ({ ...existing, [`${turnNumber}:${phase}`]: value }))

  const turnNumbers = [...new Set([...mine.map((turn) => turn.turnNumber), turnNumber])].sort(
    (a, b) => a - b,
  )

  return (
    <section className="panel">
      <h2>Turn orders</h2>
      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="row">
        <label style={{ margin: 0 }}>
          Turn
          <select
            value={turnNumber}
            onChange={(event) => setTurnNumber(Number(event.target.value))}
            style={{ width: 'auto' }}
          >
            {turnNumbers.map((number) => (
              <option key={number} value={number}>
                {number}
              </option>
            ))}
          </select>
        </label>
        <button className="small" onClick={() => setTurnNumber(turnNumber + 1)}>
          New turn
        </button>
        {current?.disabled === true && <span className="tag">locked</span>}
        <span style={{ flex: 1 }} />
        <button
          className="small"
          disabled={busy}
          onClick={() =>
            void run(() => api.lockTurn(gameId, turnNumber, current?.disabled !== true))
          }
        >
          {current?.disabled === true ? 'Reopen' : 'Lock the turn'}
        </button>
      </div>

      {TURN_PHASES.map((phase) => (
        <label key={phase}>
          {TURN_PHASE_LABEL[phase]}
          <textarea
            value={valueFor(phase)}
            onChange={(event) => setDraft(phase, event.target.value)}
            style={{ minHeight: '3.5rem' }}
          />
          <button
            className="small"
            disabled={busy}
            style={{ marginTop: '0.25rem' }}
            onClick={() =>
              void run(() => api.updateTurn(gameId, turnNumber, phase, valueFor(phase)))
            }
          >
            Save {TURN_PHASE_LABEL[phase]}
          </button>
        </label>
      ))}

      <h3 style={{ marginTop: '1rem' }}>All orders</h3>
      <ul className="list scroll">
        {publicTurns.map((turn) => (
          <li key={`${turn.turnNumber}-${turn.username}`} style={{ display: 'block' }}>
            <div className="row">
              <strong>
                Turn {turn.turnNumber} — {turn.username}
              </strong>
              {turn.disabled && <span className="tag">locked</span>}
            </div>
            {TURN_PHASES.filter((phase) => turn.orders[phase] !== '').map((phase) => (
              <div key={phase} className="muted" style={{ fontSize: '0.85rem' }}>
                <em>{TURN_PHASE_LABEL[phase]}:</em> {turn.orders[phase]}
              </div>
            ))}
          </li>
        ))}
        {publicTurns.length === 0 && <li className="muted">No orders written yet.</li>}
      </ul>
    </section>
  )
}
