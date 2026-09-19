/**
 * Techs and social policy.
 *
 * Both are hidden until the player chooses to reveal them, and the public log
 * only says that "a hidden technology" was researched.
 */

import { useCallback, useEffect, useState } from 'react'

import type { SocialPolicyItem, TechItem } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView, RevealedTechsDto } from '../lib/api.js'
import { TechTree } from './TechTree.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { ItemCard } from './ItemCard.js'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly view: PlayerView
  /** Bumped by GameView after each action, so the lists are fetched again. */
  readonly reloadCount: number
}

export function TechPanel({ gameId, busy, run, view, reloadCount }: Props): React.JSX.Element {
  const [available, setAvailable] = useState<readonly TechItem[]>([])
  const [revealed, setRevealed] = useState<readonly RevealedTechsDto[]>([])
  const [policies, setPolicies] = useState<readonly SocialPolicyItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosenTech, setChosenTech] = useState('')
  const [chosenPolicy, setChosenPolicy] = useState('')

  const load = useCallback(async () => {
    try {
      const [techs, all, socialPolicies] = await Promise.all([
        api.availableTechs(gameId),
        api.revealedTechs(gameId),
        api.socialPolicies(gameId),
      ])
      setAvailable(techs)
      setRevealed(all)
      setPolicies(socialPolicies)
      setLoadError(null)
    } catch (caught) {
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  const yourTechs = view.you?.techsChosen ?? []
  const yourPolicies = view.you?.socialPolicies ?? []

  return (
    <CollapsiblePanel id="techs" title="Techs" defaultOpen={false}>
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
        {yourTechs.map((tech) => (
          <li key={tech.id}>
            <span>{tech.name}</span>
            <span className="muted">level {tech.level}</span>
            <span className={tech.hidden ? 'tag hidden' : 'tag revealed'}>
              {tech.hidden ? 'hidden' : 'revealed'}
            </span>
            <span style={{ flex: 1 }} />
            {tech.hidden && (
              <button
                className="small"
                disabled={busy}
                onClick={() => void run(() => api.revealTech(gameId, tech.name))}
              >
                Reveal
              </button>
            )}
            <button
              className="small"
              disabled={busy}
              onClick={() => void run(() => api.removeTech(gameId, tech.name))}
            >
              Remove
            </button>
          </li>
        ))}
        {yourTechs.length === 0 && <li className="muted">None chosen.</li>}
      </ul>

      <h3 style={{ marginTop: '0.8rem' }}>Revealed by everyone</h3>
      {revealed.map((entry) => (
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
      {revealed.length === 0 && <p className="muted">Nobody has chosen a civilization yet.</p>}

      <h2 style={{ marginTop: '1rem' }}>Social policy</h2>
      <div className="row">
        <select
          value={chosenPolicy}
          onChange={(event) => setChosenPolicy(event.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">choose a card …</option>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.name}>
              {policy.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || chosenPolicy === ''}
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
    </CollapsiblePanel>
  )
}
