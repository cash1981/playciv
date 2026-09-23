/**
 * One coloured tab per player, shared by the Techs and Social policy panels.
 *
 * The look and the keyboard handling follow the turn-order tabs (`TurnTabs` in
 * `TurnPanel.tsx`): the label is the username and the accent is the player's
 * board colour. The panels pass their own ids for `aria-controls` /
 * `aria-labelledby`.
 */

import type { CSSProperties, KeyboardEvent } from 'react'

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
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const all = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    )
    const currentIndex = all.indexOf(event.currentTarget)
    if (currentIndex < 0 || all.length === 0) return
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? all.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length
    event.preventDefault()
    all[nextIndex]?.focus()
    all[nextIndex]?.click()
  }

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
            onKeyDown={handleKeyDown}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
