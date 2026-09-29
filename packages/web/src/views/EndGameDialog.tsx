/**
 * Ends the game, optionally naming a winner. Opened from the site menu's Game
 * section. The player list is the usernames already in the projected view, so
 * nothing hidden is needed to fill the dropdown.
 */

import { useState } from 'react'
import type { RefObject } from 'react'

import { ReferenceDialog } from './ReferenceDialog.js'

interface Props {
  /** Usernames of everyone in the game, in seat order. */
  readonly players: readonly string[]
  readonly busy: boolean
  /** `undefined` means "No winner". */
  readonly onConfirm: (winner: string | undefined) => void
  readonly onClose: () => void
  readonly returnFocusTo?: RefObject<HTMLElement | null>
}

/** The empty value of the first option; no username can be empty. */
const NO_WINNER = ''

export function EndGameDialog({
  players,
  busy,
  onConfirm,
  onClose,
  returnFocusTo,
}: Props): React.JSX.Element {
  const [winner, setWinner] = useState(NO_WINNER)

  return (
    <ReferenceDialog
      titleId="end-game-title"
      title="End game"
      className="end-game-dialog"
      onClose={onClose}
      {...(returnFocusTo === undefined ? {} : { returnFocusTo })}
    >
      <div className="end-game-content">
        <p className="muted">
          Ending the game closes it for everyone and cannot be undone. Pick the winner, or choose
          No winner.
        </p>
        <label htmlFor="end-game-winner">
          Winner
          <select
            id="end-game-winner"
            value={winner}
            onChange={(event) => setWinner(event.target.value)}
          >
            <option value={NO_WINNER}>No winner</option>
            {players.map((username) => (
              <option key={username} value={username}>
                {username}
              </option>
            ))}
          </select>
        </label>
        <div className="end-game-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => onConfirm(winner === NO_WINNER ? undefined : winner)}
          >
            End game
          </button>
        </div>
      </div>
    </ReferenceDialog>
  )
}
