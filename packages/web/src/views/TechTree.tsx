/**
 * The tech pyramid.
 *
 * Model: `old-civ-web/app/views/partials/techtree.html` and
 * `TechController.getChosenTech` / `getAvailableTech`. Five rows, level 1 at
 * the base with 5 slots, narrowing to level 5 at the apex with 1 slot. A
 * researched slot shows the card art (issue #168), with the name kept as
 * `title`/text underneath as a fallback; an empty slot shows the trade cost
 * for that level. The component only lays out whatever list of techs it is
 * given — it does not know or care whether those are the viewer's own or a
 * public set, so it deliberately does not import the engine `Item` type or
 * `itemImage()`. The file name is built inline instead, following the same
 * rule as `itemImage()`'s `tech` case in `item.ts`.
 *
 * A tech's displayed row can differ from its real `level` (Nikola Tesla), and
 * a Great Person can occupy a row as a blank placement (Sir Isaac Newton) —
 * see `docs/agents/tasks/issue-168-tech-revamp-pyramid-reposition.md`. Both
 * are unenforced and unlogged by design; this component only renders the
 * stepper controls when the caller provides the matching `onXSlotChange` prop
 * (only the viewer's own pyramid does).
 */

type Level = 1 | 2 | 3 | 4 | 5

/** Mirrors `itemImage()`'s `tech` case: `${name}.jpg` with spaces stripped. */
export function techCardImageUrl(name: string): string {
  return `/items/${encodeURIComponent(`${name}.jpg`.replace(/ /g, ''))}`
}

/** The generic, name-independent card back for any placed Great Person. */
const GREAT_PERSON_PLACEMENT_IMAGE = '/items/greatperson_back.jpg'

export interface TechTreeTech {
  readonly name: string
  readonly level: Level
  /** Set on the viewer's own pyramid to mark a tech nobody else can see yet. */
  readonly hidden?: boolean
  /** Where a Great Person (Nikola Tesla) has moved this tech's display row. */
  readonly slot?: Level
}

/**
 * A Great Person placed face-down as a blank pyramid occupant (Sir Isaac
 * Newton). `name` is present only on the viewer's own pyramid — the card is
 * placed facedown as a blank tech card, so an opponent's projection carries
 * the slot only, never the identity of the placed card.
 */
export interface TechTreePlacement {
  readonly name?: string
  readonly slot: Level
}

/** Shown in place of the real name when an opponent's placement has none. */
const BLANK_PLACEMENT_LABEL = 'Blank tech card'

interface Props {
  readonly techs: readonly TechTreeTech[]
  readonly placements?: readonly TechTreePlacement[]
  readonly disabled?: boolean
  /** Present only on the viewer's own pyramid. */
  readonly onTechSlotChange?: (techName: string, slot: Level) => void
  readonly onPlacementSlotChange?: (name: string, slot: Level) => void
}

/** Java's TechController hard-coded these: 5, 4, 3, 2, 1 slots per level. */
const SLOTS_PER_LEVEL: Record<Level, number> = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 }

/**
 * Trade cost shown on an empty slot, from the old client's tooltips
 * ("11 trade needed to learn level 2 tech", and so on). Level 5 had no
 * tooltip in the old client, so it is left blank.
 */
const TRADE_COST: Record<Level, number | null> = { 1: 6, 2: 11, 3: 16, 4: 21, 5: null }

// Level 1 is the base of the pyramid (rendered last, more slots); level 5 is
// the apex (rendered first, fewer slots). "Lower"/"higher" in the stepper
// labels below refer to the row number, matching this order.
const LEVELS_APEX_FIRST: readonly Level[] = [5, 4, 3, 2, 1]

export function TechTree({
  techs,
  placements = [],
  disabled,
  onTechSlotChange,
  onPlacementSlotChange,
}: Props): React.JSX.Element {
  return (
    <div className="tech-pyramid">
      {LEVELS_APEX_FIRST.map((level) => {
        const slots = SLOTS_PER_LEVEL[level]
        const researched = techs.filter((tech) => (tech.slot ?? tech.level) === level)
        const placed = placements.filter((placement) => placement.slot === level)
        const emptyCount = Math.max(slots - researched.length - placed.length, 0)
        const cost = TRADE_COST[level]

        return (
          <div className="tech-pyramid-row" key={level}>
            {researched.map((tech) => {
              const slot = tech.slot ?? tech.level
              return (
                <div
                  key={tech.name}
                  className={tech.hidden === true ? 'tech-slot researched hidden' : 'tech-slot researched'}
                  title={tech.name}
                >
                  <img
                    className="tech-slot-image"
                    src={techCardImageUrl(tech.name)}
                    alt=""
                    onError={(event) => {
                      // A missing file should leave the name readable, not a broken icon.
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                  <span className="tech-slot-label">{tech.name}</span>
                  {onTechSlotChange !== undefined && (
                    <span className="tech-slot-move">
                      <button
                        type="button"
                        className="small"
                        disabled={disabled === true || slot <= 1}
                        aria-label={`Move ${tech.name} to a lower pyramid row`}
                        onClick={() => onTechSlotChange(tech.name, (slot - 1) as Level)}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="small"
                        disabled={disabled === true || slot >= 5}
                        aria-label={`Move ${tech.name} to a higher pyramid row`}
                        onClick={() => onTechSlotChange(tech.name, (slot + 1) as Level)}
                      >
                        ▲
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
            {placed.map((placement, index) => {
              const label = placement.name ?? BLANK_PLACEMENT_LABEL
              return (
                <div
                  key={placement.name ?? `placement-${level}-${index}`}
                  className="tech-slot researched placement"
                  title={label}
                >
                  <img
                    className="tech-slot-image"
                    src={GREAT_PERSON_PLACEMENT_IMAGE}
                    alt={label}
                    onError={(event) => {
                      // A missing file should leave the label readable, not a broken icon.
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                  <span className="tech-slot-label">{label}</span>
                  {onPlacementSlotChange !== undefined && placement.name !== undefined && (
                    <span className="tech-slot-move">
                      <button
                        type="button"
                        className="small"
                        disabled={disabled === true || placement.slot <= 1}
                        aria-label={`Move ${placement.name} to a lower pyramid row`}
                        onClick={() => onPlacementSlotChange(placement.name!, (placement.slot - 1) as Level)}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="small"
                        disabled={disabled === true || placement.slot >= 5}
                        aria-label={`Move ${placement.name} to a higher pyramid row`}
                        onClick={() => onPlacementSlotChange(placement.name!, (placement.slot + 1) as Level)}
                      >
                        ▲
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
            {Array.from({ length: emptyCount }, (_unused, index) => (
              <div
                key={`empty-${level}-${index}`}
                className="tech-slot available"
                title={cost === null ? undefined : `${cost} trade needed to learn a level ${level} tech`}
              >
                {cost ?? ''}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
