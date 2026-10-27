/**
 * When a culture event or Great Person card can be played, and what the log needs
 * to say about it (who is targeted, which resource it is played as).
 *
 * The timing is not typed in a second time: it is read from the first words of the
 * card's own effect text ("Start of Turn: ...", "Any Time: ...", or two of them
 * separated by a slash for a card that is played for one phase). So a card the
 * sheet gets later needs no entry here to be listed, and a typo in the sheet is
 * fixed in one place. Only the targets and the resource choices are a table,
 * because the text only says them in prose.
 *
 * A leaf module on purpose: the web reads it for labels, so it imports nothing
 * but types.
 */

import type { TurnPhase } from './turn.js'

/** `ANY` is "Any Time"; `BATTLE` is played during a battle, which is no phase of the turn. */
export type CardTiming = TurnPhase | 'BATTLE' | 'ANY'

/** The words the card sheets use, and the timing each stands for. */
const TIMING_WORDS: readonly (readonly [string, CardTiming])[] = [
  ['Start of Any Phase', 'ANY'],
  ['Start of Turn', 'SOT'],
  ['Any Time', 'ANY'],
  ['City Management', 'CM'],
  ['Movement', 'MOVEMENT'],
  ['Research', 'RESEARCH'],
  ['Battle', 'BATTLE'],
]

/** Each word with the pattern for a segment that starts with it, made once. */
const TIMING_LABELS: readonly (readonly [RegExp, CardTiming])[] = TIMING_WORDS.map(
  ([word, timing]): readonly [RegExp, CardTiming] => [new RegExp(`^${word}\\s*:`, 'i'), timing],
)

/** How a timing reads in a log line and on a button. */
export const CARD_TIMING_TEXT: Readonly<Record<CardTiming, string>> = {
  SOT: 'start of turn',
  TRADE: 'trade',
  CM: 'city management',
  MOVEMENT: 'movement',
  RESEARCH: 'research',
  BATTLE: 'battle',
  ANY: 'any time',
}

/**
 * The timings a card's text names, in the order it names them, without repeats.
 * A segment counts only at the start of the text or right after a slash or a line
 * break (the sheets use both between two timings), so a word such as "Research:"
 * inside a sentence is not read as a timing. A card with no timing (a passive Great
 * Person such as Valmiki) has none.
 */
export function timingsOf(description: string | null | undefined): readonly CardTiming[] {
  if (description === null || description === undefined) return []
  const found: CardTiming[] = []
  for (const segment of description.split(/[/\n]/)) {
    const text = segment.trim()
    for (const [label, timing] of TIMING_LABELS) {
      if (label.test(text)) {
        if (!found.includes(timing)) found.push(timing)
        break
      }
    }
  }
  return found
}

/**
 * Who a card names when it is played. `players` is a choice among the other
 * players, `min` to `max` of them; `allOthers` is every other player and needs no
 * choice; `none` names nobody (a square, or the player themselves).
 */
export type CardTargets =
  | { readonly kind: 'none' }
  | { readonly kind: 'allOthers' }
  | { readonly kind: 'players'; readonly min: number; readonly max: number }

export interface CardPlayRule {
  readonly targets: CardTargets
  /** The question the target picker asks. */
  readonly prompt: string
  /** The resource the card can be played as; empty when it is not played as one. */
  readonly resources: readonly string[]
}

const none: CardPlayRule = { targets: { kind: 'none' }, prompt: '', resources: [] }
const one = (prompt: string): CardPlayRule => ({
  targets: { kind: 'players', min: 1, max: 1 },
  prompt,
  resources: [],
})
const optional = (prompt: string, max = 1): CardPlayRule => ({
  targets: { kind: 'players', min: 0, max },
  prompt,
  resources: [],
})
const asResource = (resources: readonly string[], base: CardPlayRule = none): CardPlayRule => ({
  ...base,
  resources,
})

const CANCEL = 'Whose card or action does it cancel?'
const BASIC_RESOURCES = ['Iron', 'Wheat', 'Spy', 'Silk'] as const

/**
 * What each card needs to be played, by the printed name on the sheet. The prompts
 * only decide what the picker asks; the card itself is never applied (see
 * `assisted-cards.ts`). A name not in the table gets an optional single player.
 */
const PLAY_RULES: ReadonlyMap<string, CardPlayRule> = new Map<string, CardPlayRule>([
  // Culture events, level I
  ['A Gift from Afar', asResource(BASIC_RESOURCES, one('Who receives the coin token?'))],
  ['Barbarian Encampment', none],
  ['Bread and Circuses', one(CANCEL)],
  ['Counterfeiters', one('Which player discards a coin token?')],
  ['Defection', optional('Whose figure is killed?')],
  ['Disoriented', one('Whose figures are moved?')],
  ['Drought', none],
  ['Duty and Honor', none],
  ['Exchange of Ideas', one('Which player do you exchange a tech with?')],
  ['Migrants', none],
  ['Sabotage', optional('Whose building is destroyed? (optional)')],
  ['The Citizens are Revolting!', one('Whose government changes to anarchy?')],
  ['We Love the Despot Day!', none],
  // Level II
  ['A Generous Gift', asResource(BASIC_RESOURCES)],
  ['Catastrophe', optional('Whose building is destroyed? (optional)')],
  ['Colonists', none],
  ['Deforestation', none],
  ['Depression', { targets: { kind: 'players', min: 1, max: 2 }, prompt: 'Which players discard a coin token?', resources: [] }],
  ['Flooding', none],
  ['Jousting Tourney', one('Whose culture event does it cancel?')],
  ['Knowledge Shared', one('Which player do you exchange a tech with?')],
  ['Lost', one('Whose figures are moved?')],
  ['Mass Defection', optional('Whose figures are killed?')],
  ['Nationalism', none],
  ['Roaming Horde', optional('Whose army or city is attacked?')],
  ['The Citizens are Revolting II!', one('Whose government changes to anarchy?')],
  ['We Love the Queen Day!', none],
  // Level III
  ['A Princely Gift', asResource(['Iron', 'Uranium', 'Spy', 'Wheat', 'Silk'])],
  ['Bank Scandal', { targets: { kind: 'allOthers' }, prompt: '', resources: [] }],
  ['Disaster', optional('Whose buildings are destroyed? (optional, up to two players)', 2)],
  ['Immigrants', none],
  ['Out of Position', one('Whose figures are moved?')],
  ['Patriotism', none],
  ['Primetime TV', one(CANCEL)],
  ['Supply Drop', none],
  ['Think Tank', one('Which player do you exchange a tech with?')],
  ['We Love the President Day!', none],
  ['Wholesale Defection', optional('Whose figures are killed?')],
  // Great Persons that can be played
  ['Mark Twain', optional(CANCEL)],
  ['Frida Kahlo', none],
  ['Marco Polo', none],
  ['Zheng He', none],
  ['William Shakespeare', none],
  ['Archimedes', none],
  ['Marie Curie', none],
  ['Khalid ibn al-Walid', none],
  ['Jerry Garcia', none],
  ['Michelangelo', none],
  ['Akira Kurosawa', none],
  ['Ada Lovelace', none],
  ['Frank Lloyd Wright', none],
  ['Henry Ford', none],
  ['Nikola Tesla', none],
  ['Orville Wright', none],
  ['Georgy Zhukov', none],
  ['Gustavus Adolphus', none],
  ['Hannibal', none],
  ['Joan of Arc', none],
  ['Leonidas', none],
  ['Sun Tzu', none],
  ['Florence Nightingale', none],
  ['Jacques Cousteau', none],
  ['Jim Henson', none],
  ['St. Francis of Assisi', none],
  ['A. P. Giannini', none],
  ['Andrew Carnegie', none],
  ['Captain James Cook', none],
  ["Lorenzo de' Medici", none],
  ['Albert Einstein', none],
  ['Alan Turing', none],
  ['Charles Darwin', none],
  ['Galileo Galilei', none],
  ['Sir Isaac Newton', none],
  ['Thomas Edison', one('Whose learned tech do you research?')],
  ['Mother Teresa', one('Who receives the coin token?')],
  ['Valmiki', none],
  ['Adam Smith', none],
  ['Susan B. Anthony', none],
  ['Louis Pasteur', none],
])

/**
 * What the game does itself when these Great Persons are played (`assisted-cards.ts`),
 * said to the player before they confirm. Every other card is only logged.
 */
export const AUTOMATIC_EFFECTS: ReadonlyMap<string, string> = new Map([
  ['Marco Polo', 'gains 27 trade, up to the ceiling of 27'],
  ['St. Francis of Assisi', 'gains 3 culture for every army you have not built'],
  ['Orville Wright', 'draws an aircraft unit card into your hand'],
  ['Khalid ibn al-Walid', 'moves the start player marker to your area, so the next turn passes clockwise from you'],
  ['Michelangelo', 'takes 5 production off your next wonder'],
  ['Thomas Edison', 'grants a free research of a tech another player has revealed'],
  ['Mother Teresa', 'gives one coin token to another player and advances one space for free'],
  ['Marie Curie', 'arms a substitution for your next Uranium spend'],
])

/**
 * Passive Great Persons the engine applies while the card is faceup. They have no
 * timing on the sheet; the Use button is their activation, and the text is what
 * the player is told before confirming.
 */
export const PASSIVE_GREAT_PERSONS: ReadonlyMap<string, string> = new Map([
  ['Valmiki', 'your culture hand size is increased by 2 while Valmiki is faceup'],
  ['Adam Smith', 'you have 1 extra coin while Adam Smith is faceup'],
  ['Susan B. Anthony', 'all of your cities produce 2 more hammers while Susan B. Anthony is faceup'],
  ['Louis Pasteur', 'your stacking limit is increased by 1 while Louis Pasteur is faceup'],
])

const DEFAULT_RULE: CardPlayRule = optional('Who is targeted? (optional)')

export const cardPlayRuleOf = (name: string): CardPlayRule => PLAY_RULES.get(name) ?? DEFAULT_RULE

/**
 * Great Person cards that have a Start of Turn button of their own (`assisted-abilities.ts`),
 * so the list of cards to play leaves them out: playing one there would log it without
 * the gain the button gives.
 */
export const CARDS_WITH_OWN_BUTTON: ReadonlySet<string> = new Set(["Lorenzo de' Medici", 'Alan Turing'])

/** Whether using a Great Person card discards it: its text says "discard this card". */
export const discardsWhenUsed = (description: string | null | undefined): boolean =>
  description !== null && description !== undefined && /discard this card/i.test(description)

/** Why a card cannot be played now, or that it can. */
export type PlayableCardStatus = 'ready' | 'wrong-phase' | 'unavailable' | 'used'

/**
 * One card of the viewer's hand that can be played at some time, with whether it
 * can be played right now. Own view only: it names a card from the hand.
 */
export interface PlayableCard {
  readonly itemId: string
  readonly name: string
  readonly kind: 'culture' | 'greatPerson'
  /** The card's own effect text. */
  readonly description: string
  readonly timings: readonly CardTiming[]
  readonly targets: CardTargets
  readonly prompt: string
  readonly resources: readonly string[]
  /** What the game does for the card when it is played, or null when it only logs it. */
  readonly automatic: string | null
  /** A passive effect that is active while the card stays faceup; Use only reveals it. */
  readonly passive: boolean
  /** Playing it discards the card; otherwise a Great Person turns faceup and stays. */
  readonly discards: boolean
  /** Coin tokens the card can move (Mother Teresa), empty for every other card. */
  readonly coinSources: readonly { readonly key: string; readonly label: string; readonly coins: number }[]
  /** Resources the card can substitute for Uranium (Marie Curie), empty for every other card. */
  readonly substituteResources: readonly string[]
  readonly status: PlayableCardStatus
  /** A readable sentence, also when the card is ready. */
  readonly reason: string
}
