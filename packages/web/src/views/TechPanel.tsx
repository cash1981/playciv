/**
 * Techs.
 *
 * A researched technology is public once revealed and stays hidden until then
 * (Java: `PlayerAction.revealTech`, `getTechsForAllPlayers`). One tab per
 * player switches between the pyramids (issue #140); only the viewer's own tab
 * carries the hidden list with the Reveal and Remove controls.
 *
 * Choosing a tech to research (issue #168) is a set of level tabs (1-5) over a
 * card grid of that level's available techs — the old `<select>` combo box is
 * gone. Clicking a card opens a `ReferenceDialog`/`ReferenceCard` detail view
 * with the card art, `TECH_TEXT` (for levels 1-4) and the Research button,
 * following the same pattern `SocialPolicyPanel`'s card reference already
 * uses. Per-tech effects are display text only; the engine does not enforce
 * them, exactly as that dialog's own note already says for social policies.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { TechItem } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { GameRevisionView, PlayerView } from '../lib/api.js'
import { TechTree } from './TechTree.js'
import type { TechTreeTech } from './TechTree.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { ItemCard, itemImageUrl } from './ItemCard.js'
import { PlayerTabs } from './PlayerTabs.js'
import type { PlayerTab } from './PlayerTabs.js'
import { ReferenceCard } from './ReferenceCard.js'
import { ReferenceDialog } from './ReferenceDialog.js'
import { Tabs } from './Tabs.js'
import { TECH_TEXT } from './techText.js'
import './PlayerTabs.css'

type Level = 1 | 2 | 3 | 4 | 5
const LEVELS: readonly Level[] = [1, 2, 3, 4, 5]
const levelTabKey = (level: Level): string => String(level)

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly view: PlayerView
  /** Bumped by GameView after each action, so the lists are fetched again. */
  readonly reloadCount: number
  readonly historical?: GameRevisionView | null
}

/** One player's tab: their public pyramid, and the hidden techs on the owner's. */
interface TechTab {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly civilization: string | null
  readonly techs: readonly TechTreeTech[]
  /** Only ever non-empty on the viewer's own tab. */
  readonly hiddenTechs: readonly TechItem[]
  /** Java: the public `numberOfTechsChosen`, shown in the opponent empty state. */
  readonly chosenCount: number
  readonly own: boolean
}

const tabId = (key: string): string => `techs-tab-${key}`
const panelId = (key: string): string => `techs-panel-${key}`

export function TechPanel({
  gameId,
  busy,
  run,
  view,
  reloadCount,
  historical = null,
}: Props): React.JSX.Element {
  const [available, setAvailable] = useState<readonly TechItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeLevel, setActiveLevel] = useState<Level>(1)
  const [detailTech, setDetailTech] = useState<TechItem | null>(null)
  const detailOpenerRef = useRef<HTMLElement | null>(null)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const requestEpoch = useRef(0)

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current
    try {
      const techs = await api.availableTechs(gameId)
      if (epoch !== requestEpoch.current) return
      setAvailable(techs)
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
      setLoadError(null)
      return
    }
    void load()
  }, [historical, load, reloadCount])

  const tabs: readonly TechTab[] = [
    ...(view.you === null
      ? []
      : [
          {
            playerId: view.you.playerId,
            username: view.you.username,
            color: view.you.color,
            civilization: view.you.civilization?.name ?? null,
            techs: view.you.techsChosen.map((tech) => ({
              name: tech.name,
              level: tech.level,
              hidden: tech.hidden,
            })),
            hiddenTechs: view.you.techsChosen.filter((tech) => tech.hidden),
            chosenCount: view.you.techsChosen.length,
            own: true,
          },
        ]),
    ...view.opponents.map((opponent) => ({
      playerId: opponent.playerId,
      username: opponent.username,
      color: opponent.color,
      civilization: opponent.civilization?.name ?? null,
      techs: opponent.revealedTechs.map((tech) => ({ name: tech.name, level: tech.level })),
      hiddenTechs: [],
      chosenCount: opponent.numberOfTechsChosen,
      own: false,
    })),
  ]
  const active = tabs.find((tab) => tab.playerId === selectedPlayerId) ?? tabs[0]

  return (
    <CollapsiblePanel id="techs" title="Techs">
      {loadError !== null && <div className="error">{loadError}</div>}

      <Tabs
        tabs={LEVELS.map((level) => ({ key: levelTabKey(level), label: `Level ${level}` }))}
        active={levelTabKey(activeLevel)}
        onSelect={(key) => setActiveLevel(Number(key) as Level)}
      />
      <ul className="card-grid">
        {available
          .filter((tech) => tech.level === activeLevel)
          .map((tech) => (
            <ItemCard
              key={tech.id}
              item={tech}
              role="button"
              tabIndex={0}
              onClick={(event) => {
                detailOpenerRef.current = event.currentTarget
                setDetailTech(tech)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                detailOpenerRef.current = event.currentTarget
                setDetailTech(tech)
              }}
            />
          ))}
        {available.filter((tech) => tech.level === activeLevel).length === 0 && (
          <li className="muted">No level {activeLevel} techs available to research.</li>
        )}
      </ul>

      {detailTech !== null && (
        <ReferenceDialog
          titleId="tech-detail-title"
          title={`${detailTech.name} — Level ${detailTech.level}`}
          returnFocusTo={detailOpenerRef}
          onClose={() => setDetailTech(null)}
        >
          <ReferenceCard
            name={detailTech.name}
            image={itemImageUrl(detailTech)}
            imageAlt={`${detailTech.name} tech card`}
          >
            {TECH_TEXT[detailTech.name] !== undefined && <p>{TECH_TEXT[detailTech.name]}</p>}
          </ReferenceCard>
          <p className="muted">
            Card text is shown for reference only; the engine records the chosen tech but does
            not enforce its effects.
          </p>
          <div className="row">
            <button
              disabled={busy}
              onClick={() => {
                const techName = detailTech.name
                setDetailTech(null)
                void run(() => api.chooseTech(gameId, techName))
              }}
            >
              Research
            </button>
          </div>
        </ReferenceDialog>
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
        ariaLabel="Technologies by player"
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
          <TechTree techs={active.techs} />

          {active.own ? (
            <ul className="list scroll">
              {active.hiddenTechs.map((tech) => (
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
              {active.hiddenTechs.length === 0 && (
                <li className="muted">
                  {active.chosenCount === 0
                    ? 'None chosen.'
                    : 'All researched techs are revealed.'}
                </li>
              )}
            </ul>
          ) : (
            active.techs.length === 0 && (
              <p className="muted">
                {active.chosenCount === 0
                  ? 'Has not researched any technologies.'
                  : 'Has researched technologies, but not revealed any.'}
              </p>
            )
          )}
        </div>
      )}
    </CollapsiblePanel>
  )
}
