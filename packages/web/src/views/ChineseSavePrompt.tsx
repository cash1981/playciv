/**
 * The Chinese save a killed unit (issue #368): "The Chinese may save one of their killed units after each battle, returning
 * it to their standing forces." End battle has discarded the killed units' cards; until the next battle starts the Chinese
 * player picks one of their own killed units here and its card goes back to the hand. It is shown in the Battle panel, where
 * the arena is, and in "Your actions", like a conquest offer.
 *
 * Nothing here is a rule. Only the Chinese player's own view carries the choices (`view.you.chineseSave`), so the opponent
 * sees nothing; the engine checks the pick again against the fresh state.
 */

import { useState } from 'react'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import './ConquestPrompt.css'

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** The region's name; the Battle panel's copy has its own, so the two can be told apart. */
  readonly label?: string
}

/** The Chinese player's killed units they may save, with a Save button. Nothing when there is no choice. */
export function ChineseSavePrompt({ gameId, view, busy, readOnly, run, label = 'Chinese save' }: Props): React.JSX.Element | null {
  const [choice, setChoice] = useState('')
  const units = view.you?.chineseSave?.units ?? []
  if (units.length === 0) return null
  // A pick that is no longer offered (the battle was taken back) counts as none
  const picked = units.some((unit) => unit.arenaUnitId === choice) ? choice : ''

  return (
    <section className="assisted-conquest" aria-label={label}>
      <div className="assisted-conquest-offer">
        <p className="assisted-conquest-text">
          As the Chinese you may save one of your units killed in the last battle: its card goes back to your hand.
        </p>
        <div className="assisted-action">
          <select
            aria-label="Killed unit to save"
            value={picked}
            disabled={busy || readOnly}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Choose a unit…</option>
            {units.map((unit) => (
              <option key={unit.arenaUnitId} value={unit.arenaUnitId}>
                {unit.name} (front {unit.position + 1})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="small"
            disabled={busy || readOnly || picked === ''}
            onClick={() => void run(() => api.chineseSave(gameId, picked, view.rev))}
          >
            Save unit
          </button>
        </div>
      </div>
    </section>
  )
}
