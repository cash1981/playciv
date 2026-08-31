/**
 * Port av `no.asgari.civilization.server.model.PlayerTurn`.
 *
 * En tur består av fem faser. Hver fase har en gjeldende ordre og en historikk
 * over tidligere ordrer, slik at spillerne kan se hva som ble endret.
 *
 * `TurnKey.java` er ikke portert. Den var et forsøk på en sammensatt
 * nøkkel for `publicTurns`, men Java fikk ikke Jackson til å serialisere
 * kartet og endte med å konkatenere `turnNumber + username` til en streng.
 * Den strengen er beholdt som nøkkelformat.
 */

export const TURN_PHASES = ['SOT', 'TRADE', 'CM', 'MOVEMENT', 'RESEARCH'] as const
export type TurnPhase = (typeof TURN_PHASES)[number]

export const TURN_PHASE_LABEL: Readonly<Record<TurnPhase, string>> = {
  SOT: 'start of turn',
  TRADE: 'trade',
  CM: 'city management',
  MOVEMENT: 'movement',
  RESEARCH: 'research',
}

export interface PlayerTurn {
  readonly turnNumber: number
  readonly username: string
  /** Java: `disabled` — satt når spilleren har låst turen. */
  readonly disabled: boolean
  readonly orders: Readonly<Record<TurnPhase, string>>
  /**
   * Java hadde `Set<String>` per fase, altså uten rekkefølge. Her beholdes
   * innsettingsrekkefølgen, siden historikk uten rekkefølge er lite verdt.
   */
  readonly history: Readonly<Record<TurnPhase, readonly string[]>>
}

const emptyOrders = (): Record<TurnPhase, string> => ({
  SOT: '',
  TRADE: '',
  CM: '',
  MOVEMENT: '',
  RESEARCH: '',
})

const emptyHistory = (): Record<TurnPhase, readonly string[]> => ({
  SOT: [],
  TRADE: [],
  CM: [],
  MOVEMENT: [],
  RESEARCH: [],
})

export function createPlayerTurn(username: string, turnNumber: number): PlayerTurn {
  return {
    turnNumber,
    username,
    disabled: false,
    orders: emptyOrders(),
    history: emptyHistory(),
  }
}

/** Java: `equals` på PlayerTurn brukte turnNumber + username. */
export function sameTurn(a: PlayerTurn, b: PlayerTurn): boolean {
  return a.turnNumber === b.turnNumber && a.username === b.username
}

/**
 * Javas `String.compareTo` sammenligner UTF-16-kodeenheter, ikke etter
 * lokalregler. Det betyr at "Karandras1" kommer før "cash1981", fordi store
 * bokstaver har lavere kodepunkt. `localeCompare` gir motsatt rekkefølge.
 */
export function compareJavaStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Java: `compareTo` sorterte på turnummer, deretter brukernavn. */
export function compareTurns(a: PlayerTurn, b: PlayerTurn): number {
  return a.turnNumber - b.turnNumber || compareJavaStrings(a.username, b.username)
}

/** Setter ordren for én fase og legger den i historikken. */
export function withOrder(turn: PlayerTurn, phase: TurnPhase, order: string): PlayerTurn {
  const existing = turn.history[phase]
  return {
    ...turn,
    orders: { ...turn.orders, [phase]: order },
    history: {
      ...turn.history,
      // Java brukte Set, så samme ordre to ganger ga bare én oppføring
      [phase]: existing.includes(order) ? existing : [...existing, order],
    },
  }
}

/**
 * Java: nøkkelen i `PBF.publicTurns`, laget som `turnNumber + username`.
 * Merk at den er tvetydig: tur 11 for «a» og tur 1 for «1a» gir samme nøkkel.
 * Formatet er beholdt for kompatibilitet med eksisterende Mongo-dokumenter.
 */
export function publicTurnKey(turn: PlayerTurn): string {
  return `${turn.turnNumber}${turn.username}`
}

/**
 * Java: `TurnAction.getAllPublicTurns` fjernet den gjeldende ordren fra
 * historikken før den returnerte — men gjorde det ved å mutere de lagrede
 * objektene, så en lesing ødela data. Her er det en ren projeksjon.
 */
export function withoutCurrentOrderInHistory(turn: PlayerTurn): PlayerTurn {
  const history = { ...turn.history }
  for (const phase of TURN_PHASES) {
    history[phase] = turn.history[phase].filter((order) => order !== turn.orders[phase])
  }
  return { ...turn, history }
}

/** Java: `PlayerTurn.endTurn()` økte turnummeret. */
export function nextTurnNumber(turn: PlayerTurn): number {
  return turn.turnNumber + 1
}
