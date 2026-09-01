/**
 * Teknologier og sosialpolitikk.
 *
 * Begge er skjult informasjon til spilleren velger å avsløre dem, og den
 * offentlige loggen sier bare at «en skjult teknologi» er forsket fram.
 */

import { useCallback, useEffect, useState } from 'react'

import type { SocialPolicyItem, TechItem } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView, RevealedTechsDto } from '../lib/api.js'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly view: PlayerView
  /** Økes av GameView etter hver handling, så listene hentes på nytt. */
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
    <section className="panel">
      <h2>Teknologi</h2>
      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="row">
        <select
          value={chosenTech}
          onChange={(event) => setChosenTech(event.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">velg teknologi …</option>
          {available.map((tech) => (
            <option key={tech.id} value={tech.name}>
              Nivå {tech.level} — {tech.name}
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
          Forsk
        </button>
      </div>

      <h3 style={{ marginTop: '0.8rem' }}>Dine ({yourTechs.length})</h3>
      <ul className="list scroll">
        {yourTechs.map((tech) => (
          <li key={tech.id}>
            <span>{tech.name}</span>
            <span className="muted">nivå {tech.level}</span>
            <span className={tech.hidden ? 'tag hidden' : 'tag revealed'}>
              {tech.hidden ? 'skjult' : 'avslørt'}
            </span>
            <span style={{ flex: 1 }} />
            {tech.hidden && (
              <button
                className="small"
                disabled={busy}
                onClick={() => void run(() => api.revealTech(gameId, tech.name))}
              >
                Avslør
              </button>
            )}
            <button
              className="small"
              disabled={busy}
              onClick={() => void run(() => api.removeTech(gameId, tech.name))}
            >
              Fjern
            </button>
          </li>
        ))}
        {yourTechs.length === 0 && <li className="muted">Ingen valgt.</li>}
      </ul>

      <h3 style={{ marginTop: '0.8rem' }}>Avslørt hos alle</h3>
      <ul className="list">
        {revealed.map((entry) => (
          <li key={entry.civilization}>
            <strong>{entry.civilization}</strong>
            <span className="muted">
              {entry.techs.length === 0
                ? 'ingenting avslørt'
                : entry.techs.map((tech) => tech.name).join(', ')}
            </span>
          </li>
        ))}
        {revealed.length === 0 && <li className="muted">Ingen har valgt sivilisasjon ennå.</li>}
      </ul>

      <h2 style={{ marginTop: '1rem' }}>Sosialpolitikk</h2>
      <div className="row">
        <select
          value={chosenPolicy}
          onChange={(event) => setChosenPolicy(event.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">velg kort …</option>
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
          Velg
        </button>
      </div>
      <ul className="list">
        {yourPolicies.map((policy) => (
          <li key={policy.id}>
            <span>{policy.name}</span>
            {policy.flipside !== null && (
              <span className="muted">bakside: {policy.flipside}</span>
            )}
          </li>
        ))}
        {yourPolicies.length === 0 && <li className="muted">Ingen valgt.</li>}
      </ul>
    </section>
  )
}
