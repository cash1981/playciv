/**
 * Techs and social policy.
 *
 * Both are hidden until the player chooses to reveal them, and the public log
 * only says that "a hidden technology" was researched.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { SocialPolicyItem, TechItem } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { GameRevisionView, PlayerView, RevealedTechsDto } from '../lib/api.js'
import { TechTree } from './TechTree.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { ItemCard, itemImageUrl } from './ItemCard.js'
import { ReferenceCard } from './ReferenceCard.js'
import { ReferenceDialog } from './ReferenceDialog.js'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly view: PlayerView
  /** Bumped by GameView after each action, so the lists are fetched again. */
  readonly reloadCount: number
  readonly historical?: GameRevisionView | null
}

export function TechPanel({ gameId, busy, run, view, reloadCount, historical = null }: Props): React.JSX.Element {
  const [available, setAvailable] = useState<readonly TechItem[]>([])
  const [revealed, setRevealed] = useState<readonly RevealedTechsDto[]>([])
  const [policies, setPolicies] = useState<readonly SocialPolicyItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosenTech, setChosenTech] = useState('')
  const [chosenPolicy, setChosenPolicy] = useState('')
  const [showPolicyReference, setShowPolicyReference] = useState(false)
  const policyHelpRef = useRef<HTMLButtonElement | null>(null)
  const requestEpoch = useRef(0)

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current
    try {
      const [techs, all, socialPolicies] = await Promise.all([
        api.availableTechs(gameId),
        api.revealedTechs(gameId),
        api.socialPolicies(gameId),
      ])
      if (epoch !== requestEpoch.current) return
      setAvailable(techs)
      setRevealed(all)
      setPolicies(socialPolicies)
      setLoadError(null)
    } catch (caught) {
      if (epoch !== requestEpoch.current) return
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  useEffect(() => {
    if (historical !== null) {
      requestEpoch.current += 1
      setAvailable(historical.availableTechs)
      setRevealed(historical.revealedTechs)
      setPolicies(historical.socialPolicies)
      setLoadError(null)
      return
    }
    void load()
  }, [historical, load, reloadCount])

  const yourTechs = view.you?.techsChosen ?? []
  const yourPolicies = view.you?.socialPolicies ?? []
  // A revealed tech is already on the pyramid, so only the hidden ones keep a
  // row with the Reveal and Remove controls.
  const hiddenTechs = yourTechs.filter((tech) => tech.hidden)
  // The viewer's own pyramid is already under "Yours"; drop it from the
  // opponents' section so it is not drawn twice.
  const otherRevealed = revealed.filter(
    (entry) => entry.civilization !== view.you?.civilization?.name,
  )

  /**
   * Why a social policy cannot be chosen, or null when it can. Mirrors
   * `chooseSocialPolicy` in the engine exactly — a policy already held, or one
   * whose own flipside is held, is rejected there (Java:
   * `PlayerAction.chooseSocialPolicy`). The comparison is deliberately
   * directional, like the engine's: the candidate's `flipside` is checked, not
   * "same pair both ways", so a card the engine would accept stays selectable.
   */
  const chosenPolicyNames = new Set(yourPolicies.map((policy) => policy.name))
  function policyUnavailableReason(policy: SocialPolicyItem): string | null {
    if (chosenPolicyNames.has(policy.name)) return 'already chosen'
    if (policy.flipside !== null && chosenPolicyNames.has(policy.flipside)) {
      return `flipside of ${policy.flipside}`
    }
    return null
  }
  const unavailablePolicies = policies.filter((policy) => policyUnavailableReason(policy) !== null)
  const chosenPolicyBlocked =
    chosenPolicy !== '' &&
    policies.some(
      (policy) => policy.name === chosenPolicy && policyUnavailableReason(policy) !== null,
    )

  return (
    <CollapsiblePanel id="techs-social-policy" title="Techs & Social policy" defaultOpen>
      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="row">
        <select
          value={chosenTech}
          onChange={(event) => setChosenTech(event.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">choose a tech …</option>
          {available.map((tech) => (
            <option key={tech.id} value={tech.name}>
              Level {tech.level} — {tech.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || chosenTech === ''}
          onClick={() =>
            void run(async () => {
              const result = await api.chooseTech(gameId, chosenTech)
              setChosenTech('')
              return result
            })
          }
        >
          Research
        </button>
      </div>

      <h3 style={{ marginTop: '0.8rem' }}>Yours ({yourTechs.length})</h3>
      <TechTree
        techs={yourTechs.map((tech) => ({ name: tech.name, level: tech.level, hidden: tech.hidden }))}
      />
      <ul className="list scroll">
        {hiddenTechs.map((tech) => (
          <li key={tech.id}>
            <span>{tech.name}</span>
            <span className="muted">level {tech.level}</span>
            <span className="tag hidden">hidden</span>
            <span style={{ flex: 1 }} />
            <button
              className="small"
              disabled={busy}
              onClick={() => void run(() => api.revealTech(gameId, tech.name))}
            >
              Reveal
            </button>
            <button
              className="small"
              disabled={busy}
              onClick={() => void run(() => api.removeTech(gameId, tech.name))}
            >
              Remove
            </button>
          </li>
        ))}
        {hiddenTechs.length === 0 && (
          <li className="muted">
            {yourTechs.length === 0 ? 'None chosen.' : 'All researched techs are revealed.'}
          </li>
        )}
      </ul>

      <h3 style={{ marginTop: '0.8rem' }}>Revealed by other players</h3>
      {otherRevealed.map((entry) => (
        <fieldset
          key={entry.civilization}
          className="tech-pyramid-block"
          style={{ borderColor: entry.color?.toLowerCase() ?? 'var(--line)' }}
        >
          <legend style={{ color: entry.color?.toLowerCase() ?? 'var(--muted)' }}>
            {entry.civilization}
          </legend>
          <TechTree techs={entry.techs.map((tech) => ({ name: tech.name, level: tech.level as 1 | 2 | 3 | 4 | 5 }))} />
        </fieldset>
      ))}
      {otherRevealed.length === 0 && (
        <p className="muted">
          {revealed.length === 0
            ? 'Nobody has chosen a civilization yet.'
            : 'No other player has chosen a civilization yet.'}
        </p>
      )}

      <h2 style={{ marginTop: '1rem' }}>Social policy</h2>
      <div className="row">
        <span className="card-control" style={{ flex: 1 }}>
          <select
            aria-label="Choose a social policy"
            value={chosenPolicy}
            onChange={(event) => setChosenPolicy(event.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">choose a card …</option>
            {policies.map((policy) => {
              const reason = policyUnavailableReason(policy)
              return (
                <option key={policy.id} value={policy.name} disabled={reason !== null}>
                  {reason === null ? policy.name : `${policy.name} — ${reason}`}
                </option>
              )
            })}
          </select>
          <button
            className="help-button"
            type="button"
            ref={policyHelpRef}
            aria-label="Show social policy card reference"
            title="Show social policy card reference"
            onClick={() => setShowPolicyReference(true)}
          >
            ?
          </button>
        </span>
        <button
          disabled={busy || chosenPolicy === '' || chosenPolicyBlocked}
          onClick={() =>
            void run(async () => {
              const result = await api.chooseSocialPolicy(gameId, chosenPolicy)
              setChosenPolicy('')
              return result
            })
          }
        >
          Choose
        </button>
      </div>
      {unavailablePolicies.length > 0 && (
        <p className="muted" role="status">
          {unavailablePolicies
            .map((policy) => `${policy.name} (${policyUnavailableReason(policy)})`)
            .join(', ')}{' '}
          cannot be chosen.
        </p>
      )}
      <ul className="card-grid small">
        {yourPolicies.map((policy) => (
          <ItemCard key={policy.id} item={policy}>
            {policy.flipside !== null && (
              <span className="muted">flipside: {policy.flipside}</span>
            )}
            <span className={policy.hidden ? 'tag hidden' : 'tag revealed'}>
              {policy.hidden ? 'hidden' : 'revealed'}
            </span>
            {policy.hidden && (
              <button
                className="small"
                disabled={busy}
                onClick={() => void run(() => api.revealSocialPolicy(gameId, policy.name))}
              >
                Reveal
              </button>
            )}
            <button
              className="small"
              disabled={busy}
              onClick={() => void run(() => api.removeSocialPolicy(gameId, policy.name))}
            >
              Remove
            </button>
          </ItemCard>
        ))}
        {yourPolicies.length === 0 && <li className="muted">None chosen.</li>}
      </ul>

      {showPolicyReference && (
        <ReferenceDialog
          titleId="social-policy-reference-title"
          title="Social policy card reference"
          returnFocusTo={policyHelpRef}
          onClose={() => setShowPolicyReference(false)}
        >
          <p className="muted">
            Card text is shown for reference only; the engine records the chosen policy but does
            not enforce its effects.
          </p>
          <div className="reference-card-grid">
            {policies.map((policy) => (
              <ReferenceCard
                key={policy.id}
                name={policy.name}
                image={itemImageUrl(policy)}
                imageAlt={`${policy.name} social policy card`}
              >
                {policy.description !== null && policy.description !== '' && (
                  <p>{policy.description}</p>
                )}
                {policy.flipside !== null && <p className="muted">Flipside: {policy.flipside}</p>}
              </ReferenceCard>
            ))}
          </div>
        </ReferenceDialog>
      )}
    </CollapsiblePanel>
  )
}
