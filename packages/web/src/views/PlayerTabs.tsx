/**
 * One coloured tab per player, shared by the Techs and Social policy panels —
 * and, without a colour, by the two sections of the Player status panel.
 *
 * The label is the username and the accent is the player's board colour. The
 * keyboard handling is the shared `handleTabKeyDown`. The panels pass their own
 * ids for `aria-controls` / `aria-labelledby`.
 */

import type { CSSProperties } from 'react'

import { handleTabKeyDown } from './tabKeys.js'

export interface PlayerTab {
  /** Stable identity for the tab: the player id. */
  readonly key: string
  readonly label: string
  readonly color: string | null
}

interface Props {
  readonly tabs: readonly PlayerTab[]
  readonly active: string
  readonly onSelect: (key: string) => void
  readonly ariaLabel: string
  readonly tabId: (key: string) => string
  readonly panelId: (key: string) => string
}

export function PlayerTabs({
  tabs,
  active,
  onSelect,
  ariaLabel,
  tabId,
  panelId,
}: Props): React.JSX.Element {
  return (
    <div className="player-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const color = tab.color?.toLowerCase() ?? 'var(--line)'
        const style = { '--player-tab-color': color } as CSSProperties
        const selected = tab.key === active
        return (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(tab.key)}
            id={tabId(tab.key)}
            tabIndex={selected ? 0 : -1}
            className="player-tab"
            style={style}
            key={tab.key}
            onClick={() => onSelect(tab.key)}
            onKeyDown={handleTabKeyDown}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
