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
  ['Disoriented', none],
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
  ['Lost', none],
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
  ['Out of Position', none],
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
  ['Archimedes', none],
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
  ['Frank Lloyd Wright', 'gains trade and culture equal to the buildings in your cities'],
  ['Andrew Carnegie', 'earns one free culture advance for every 3 coins you have, made one space at a time with the Advance buttons'],
  ['Jacques Cousteau', 'builds up to 3 Harbors in your cities for free, on the squares you choose'],
  ['Jerry Garcia', "devotes every one of your cities to the arts as your capital's action, for the culture each city's board gives, the other cities may still act"],
  ['Ada Lovelace', 'gives one extra city action this turn: a second action of a city is taken without the question'],
  ['Akira Kurosawa', 'gains you 1 culture each time another player devotes a city to the arts, while the card is faceup'],
  ['Charles Darwin', "lets you turn all of a devoted city's culture into trade, once each turn, with a box on Devote to the Arts while the card is faceup"],
  ['Albert Einstein', 'turns the trade or the unspent culture you choose into the same amount of the other'],
  ['Mother Teresa', 'gives one coin token to another player and advances one space for free'],
  ['Marie Curie', 'arms a substitution for your next Uranium spend'],
  ['Captain James Cook', 'doubles your travel speed until the end of the turn'],
  ['Galileo Galilei', 'moves every figure in the chosen outer-edge square to another outer-edge square and locks them for the turn'],
  ['Hannibal', 'moves any or all of your figures from one square to another square with your figures without exceeding your stacking limit'],
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
  ['Archimedes', 'pays 3 culture after Research for each tech no other player has revealed'],
  ['Henry Ford', 'your travel speed is increased by 1 while Henry Ford is faceup'],
])

const DEFAULT_RULE: CardPlayRule = optional('Who is targeted? (optional)')

export const cardPlayRuleOf = (name: string): CardPlayRule => PLAY_RULES.get(name) ?? DEFAULT_RULE

/**
 * Great Person cards that have a Start of Turn button of their own (`assisted-abilities.ts`),
 * so the list of cards to play leaves them out: playing one there would log it without
 * the gain the button gives.
 */
export const CARDS_WITH_OWN_BUTTON: ReadonlySet<string> = new Set(["Lorenzo de' Medici", 'Alan Turing', 'Jim Henson'])

/** Whether using a Great Person card discards it: its text says "discard this card". */
export const discardsWhenUsed = (description: string | null | undefined): boolean =>
  description !== null && description !== undefined && /discard this card/i.test(description)

/** Why a card cannot be played now, or that it can. */
export type PlayableCardStatus = 'ready' | 'wrong-phase' | 'unavailable' | 'used'

/** A square in the outskirts of one of the player's cities where Jacques Cousteau can build a free Harbor. */
export interface HarborChoice {
  readonly cityPieceId: string
  readonly cityLabel: string
  readonly column: number
  readonly row: number
  readonly label: string
}

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
  /**
   * A Great Person that is kept after use and has been used: it stays faceup and its effect
   * stands, so there is nothing to press again. The status is then `used`.
   */
  readonly inEffect: boolean
  readonly timings: readonly CardTiming[]
  readonly targets: CardTargets
  readonly prompt: string
  readonly resources: readonly string[]
  /** What the game does for the card when it is played, or null when it only logs it. */
  readonly automatic: string | null
  /**
   * The movement ability available now: a one-figure card in Movement or a group
   * card in City Management. Absent or null when this play is only the card's
   * other ability or no automation.
   */
  readonly mapMove?: { readonly kind: 'one' | 'group' | 'hannibal'; readonly allowance: number } | null
  /** A passive effect that is active while the card stays faceup; Use only reveals it. */
  readonly passive: boolean
  /** Playing it discards the card; otherwise a Great Person turns faceup and stays. */
  readonly discards: boolean
  /** Coin tokens the card can move (Mother Teresa), empty for every other card. */
  readonly coinSources: readonly { readonly key: string; readonly label: string; readonly coins: number }[]
  /** The most Albert Einstein can turn each way now, or null for every other card. */
  readonly conversion?: { readonly trade: number; readonly culture: number } | null
  /** The squares Jacques Cousteau can put a free Harbor on, null for every other card. */
  readonly harbors?: readonly HarborChoice[] | null
  /** Resources the card can substitute for Uranium (Marie Curie), empty for every other card. */
  readonly substituteResources: readonly string[]
  readonly status: PlayableCardStatus
  /** A readable sentence, also when the card is ready. */
  readonly reason: string
}
