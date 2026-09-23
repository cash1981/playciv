/**
 * Social policy.
 *
 * Split out of the Techs panel in issue #140. A chosen policy is private until
 * its owner reveals it — `revealSocialPolicy` is the port-only action, Java
 * never made policies public — and then it appears on that player's tab. One
 * tab per player switches between the cards; only the viewer's own tab carries
 * the Reveal and Remove controls. The picker greys out exactly what the engine
 * rejects (issue #101) and the `?` reference lists the public catalogue.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { SocialPolicyItem } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { GameRevisionView, PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { ItemCard, itemImageUrl } from './ItemCard.js'
import { PlayerTabs } from './PlayerTabs.js'
import type { PlayerTab } from './PlayerTabs.js'
import { ReferenceCard } from './ReferenceCard.js'
import { ReferenceDialog } from './ReferenceDialog.js'
import './PlayerTabs.css'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly view: PlayerView
  /** Bumped by GameView after each action, so the lists are fetched again. */
  readonly reloadCount: number
  readonly historical?: GameRevisionView | null
}

/** One player's tab: the policies that player may show, and whose they are. */
interface PolicyTab {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly civilization: string | null
  readonly policies: readonly SocialPolicyItem[]
  /** Java: the public `numberOfSocialPolicies`, shown in the opponent empty state. */
  readonly chosenCount: number
  readonly own: boolean
}

const tabId = (key: string): string => `social-policy-tab-${key}`
const panelId = (key: string): string => `social-policy-panel-${key}`

export function SocialPolicyPanel({
  gameId,
  busy,
  run,
  view,
  reloadCount,
  historical = null,
}: Props): React.JSX.Element {
  const [policies, setPolicies] = useState<readonly SocialPolicyItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosenPolicy, setChosenPolicy] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [showPolicyReference, setShowPolicyReference] = useState(false)
  const policyHelpRef = useRef<HTMLButtonElement | null>(null)
  const requestEpoch = useRef(0)

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current
    try {
      const socialPolicies = await api.socialPolicies(gameId)
      if (epoch !== requestEpoch.current) return
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
      setPolicies(historical.socialPolicies)
      setLoadError(null)
      return
    }
    void load()
  }, [historical, load, reloadCount])

  const yourPolicies = view.you?.socialPolicies ?? []

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

  const tabs: readonly PolicyTab[] = [
    ...(view.you === null
      ? []
      : [
          {
            playerId: view.you.playerId,
            username: view.you.username,
            color: view.you.color,
            civilization: view.you.civilization?.name ?? null,
            policies: view.you.socialPolicies,
            chosenCount: view.you.socialPolicies.length,
            own: true,
          },
        ]),
    ...view.opponents.map((opponent) => ({
      playerId: opponent.playerId,
      username: opponent.username,
      color: opponent.color,
      civilization: opponent.civilization?.name ?? null,
      policies: opponent.revealedSocialPolicies,
      chosenCount: opponent.numberOfSocialPolicies,
      own: false,
    })),
  ]
  const active = tabs.find((tab) => tab.playerId === selectedPlayerId) ?? tabs[0]

  return (
    <CollapsiblePanel id="social-policy" title="Social policy">
      {loadError !== null && <div className="error">{loadError}</div>}

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

      <PlayerTabs
        tabs={tabs.map(
          ({ playerId, username, color }): PlayerTab => ({
            key: playerId,
            label: username,
            color,
          }),
        )}
        active={active?.playerId ?? ''}
        onSelect={setSelectedPlayerId}
        ariaLabel="Social policies by player"
        tabId={tabId}
        panelId={panelId}
      />

      {active !== undefined && (
        <div
          role="tabpanel"
          id={panelId(active.playerId)}
          aria-labelledby={tabId(active.playerId)}
        >
          {active.civilization !== null && <p className="muted">{active.civilization}</p>}
          <ul className="card-grid small">
            {active.policies.map((policy) => (
              <ItemCard key={policy.id} item={policy}>
                {policy.flipside !== null && (
                  <span className="muted">flipside: {policy.flipside}</span>
                )}
                {active.own && (
                  <span className={policy.hidden ? 'tag hidden' : 'tag revealed'}>
                    {policy.hidden ? 'hidden' : 'revealed'}
                  </span>
                )}
                {active.own && policy.hidden && (
                  <button
                    className="small"
                    disabled={busy}
                    onClick={() => void run(() => api.revealSocialPolicy(gameId, policy.name))}
                  >
                    Reveal
                  </button>
                )}
                {active.own && (
                  <button
                    className="small"
                    disabled={busy}
                    onClick={() => void run(() => api.removeSocialPolicy(gameId, policy.name))}
                  >
                    Remove
                  </button>
                )}
              </ItemCard>
            ))}
            {active.policies.length === 0 && (
              <li className="muted">
                {active.own
                  ? 'None chosen.'
                  : active.chosenCount === 0
                    ? 'Has not chosen any social policies.'
                    : 'Has chosen social policies, but not revealed any.'}
              </li>
            )}
          </ul>
        </div>
      )}

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
