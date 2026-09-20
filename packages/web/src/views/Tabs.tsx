/**
 * The pill tab control, replacing old-civ-web's `uib-tabset type="pills"`.
 * Moved out of `HighscoreView` unchanged so the highscore and the game list
 * share one implementation.
 */

interface Tab<T extends string> {
  readonly key: T
  readonly label: string
}

interface Props<T extends string> {
  readonly tabs: readonly Tab<T>[]
  readonly active: T
  readonly onSelect: (key: T) => void
}

export function Tabs<T extends string>({ tabs, active, onSelect }: Props<T>): React.JSX.Element {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === active}
          className={tab.key === active ? 'tab active' : 'tab'}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
