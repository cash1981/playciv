/**
 * The tech pyramid.
 *
 * Model: `old-civ-web/app/views/partials/techtree.html` and
 * `TechController.getChosenTech` / `getAvailableTech`. Five rows, level 1 at
 * the base with 5 slots, narrowing to level 5 at the apex with 1 slot. A
 * researched slot shows the name; an empty slot shows the trade cost for that
 * level. The component only lays out whatever list of techs it is given — it
 * does not know or care whether those are the viewer's own or a public set.
 */

type Level = 1 | 2 | 3 | 4 | 5

export interface TechTreeTech {
  readonly name: string
  readonly level: Level
  /** Set on the viewer's own pyramid to mark a tech nobody else can see yet. */
  readonly hidden?: boolean
}

interface Props {
  readonly techs: readonly TechTreeTech[]
}

/** Java's TechController hard-coded these: 5, 4, 3, 2, 1 slots per level. */
const SLOTS_PER_LEVEL: Record<Level, number> = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 }

/**
 * Trade cost shown on an empty slot, from the old client's tooltips
 * ("11 trade needed to learn level 2 tech", and so on). Level 5 had no
 * tooltip in the old client, so it is left blank.
 */
const TRADE_COST: Record<Level, number | null> = { 1: 6, 2: 11, 3: 16, 4: 21, 5: null }

const LEVELS_APEX_FIRST: readonly Level[] = [5, 4, 3, 2, 1]

export function TechTree({ techs }: Props): React.JSX.Element {
  return (
    <div className="tech-pyramid">
      {LEVELS_APEX_FIRST.map((level) => {
        const slots = SLOTS_PER_LEVEL[level]
        const researched = techs.filter((tech) => tech.level === level)
        const emptyCount = Math.max(slots - researched.length, 0)
        const cost = TRADE_COST[level]

        return (
          <div className="tech-pyramid-row" key={level}>
            {researched.map((tech) => (
              <div
                key={tech.name}
                className={tech.hidden === true ? 'tech-slot researched hidden' : 'tech-slot researched'}
                title={tech.name}
              >
                {tech.name}
                {tech.hidden === true && (
                  <span className="tech-slot-badge" title="Only you can see this">
                    only you
                  </span>
                )}
              </div>
            ))}
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
