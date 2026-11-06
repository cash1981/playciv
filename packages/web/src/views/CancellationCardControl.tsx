import { startCancelPick } from '../lib/cancelPick.js'
import type { PlayerView } from '../lib/api.js'
import { revealPanel } from '../lib/reveal.js'

interface Props {
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly?: boolean
  readonly itemId: string
  readonly name: string
}

/**
 * The card of a cancellation (Twain, Jousting Tourney, Primetime TV, Bread and Circuses). Playing it does
 * not pick the target here: it starts the cancel mode of the log, which offers a button on each log line
 * the card can act on. The cancellation takes effect at once.
 */
export function CancellationCardControl({ view, busy, readOnly, itemId, name }: Props): React.JSX.Element {
  const choice = view.cancellations?.responseCards.find((c) => c.itemId === itemId)
  const eligible = choice?.targets.some((t) => t.blocked === null) === true
  return <div className="play-card-control">
    <p className="muted">Cancels an action at once; everything played after it is superseded. Wait for the others before you play on.</p>
    <button type="button" className="small" aria-label={`Play ${name}`}
      disabled={busy || readOnly || !eligible}
      onClick={() => { startCancelPick({ itemId, name }); revealPanel('log') }}>Play</button>
    <p className="muted">{eligible
      ? 'Choose the log line to act on in the log.'
      : 'Nothing in the log can be cancelled with it. Resource abilities and unrecorded targets need a table-agreed manual correction.'}</p>
  </div>
}
