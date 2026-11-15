import { startCancelPick } from '../lib/cancelPick.js'
import type { PlayerView } from '../lib/api.js'
import { revealPanel } from '../lib/reveal.js'
import { HelpHint } from './HelpHint.js'

const CANCEL_TEXT: Readonly<Record<string, string>> = {
  'Bread and Circuses': 'Cancel a culture event targeting you, one of your figures, or a square or building in one of your cities',
  'Jousting Tourney': 'Cancel any culture event',
  'Primetime TV': 'Cancel any culture event or resource ability',
  'Mark Twain': 'Cancel a city action, a culture event or a resource ability of another player',
}

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
  return <div className="play-card">
    <div className="play-card-row">
      <button type="button" className="small" aria-label={`Play ${name}`}
        disabled={busy || readOnly || !eligible}
        onClick={() => { startCancelPick({ itemId, name }); revealPanel('log') }}>Play</button>
      <HelpHint label={name}>
        {CANCEL_TEXT[name] ?? 'Cancel a culture event'}
        ; everything played after it is undone, for every player. Wait for the others before you play on.{' '}
        {eligible
          ? 'Choose the log line to act on in the log.'
          : 'Nothing in the log can be cancelled with it right now.'}
      </HelpHint>
    </div>
  </div>
}
