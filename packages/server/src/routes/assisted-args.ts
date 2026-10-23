/**
 * The payload of the assisted actions that carry one in `args` (assisted play,
 * part 9). Each action has its own strict parser: a known shape, ids in the usual
 * safe set, nothing extra. Whether the card, the players or the square are legal is
 * the engine's decision, made from the fresh state.
 *
 * The older actions (`chooseReward`, `build`, `startBuildingProgram`,
 * `upgradeBuildings`) keep their own top-level fields in `play.ts`.
 */

import type { AssistedPayload, PlayCardPayload } from '@civ/engine'

import { asRecord } from '../context.js'

/** What a request may use as an id: 1 to 64 characters of a small safe set. */
const ID = /^[A-Za-z0-9._:-]{1,64}$/

/** The most players a card can name at once (a five player game has four others). */
const MAX_TARGETS = 4

const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)

/** The keys of `record` that are not in `allowed`. */
const extraKeys = (record: Record<string, unknown>, allowed: readonly string[]): readonly string[] =>
  Object.keys(record).filter((key) => !allowed.includes(key))

function parsePlayCard(args: Record<string, unknown>): PlayCardPayload | string {
  const extra = extraKeys(args, ['itemId', 'targets', 'resource'])
  if (extra.length > 0) return `playCard takes only itemId, targets and resource, not ${extra.join(', ')}`
  if (!isId(args['itemId'])) return 'itemId is required: 1 to 64 characters, letters, digits and . _ : -'
  const targets = args['targets'] === undefined ? [] : args['targets']
  if (!Array.isArray(targets) || targets.length > MAX_TARGETS || !targets.every(isId)) {
    return `targets must be a list of at most ${MAX_TARGETS} player ids`
  }
  const resource = args['resource']
  if (resource !== undefined && (typeof resource !== 'string' || resource.length === 0 || resource.length > 20)) {
    return 'resource must be a short text'
  }
  return {
    itemId: args['itemId'],
    targets,
    ...(resource === undefined ? {} : { resource }),
  }
}

/** The actions whose payload is `args`, with the parser of each. */
const PARSERS: Readonly<Record<string, (args: Record<string, unknown>) => AssistedPayload | string>> = {
  playCard: parsePlayCard,
}

/** Whether `action` takes `args`. */
export const takesArgs = (action: string): boolean => Object.hasOwn(PARSERS, action)

/**
 * The payload of `action` from the body's `args`, or a sentence saying what is
 * wrong with it. `args` must be an object for an action that takes it.
 */
export function parseActionArgs(action: string, raw: unknown): AssistedPayload | string {
  const parser = PARSERS[action]
  if (parser === undefined) return `${action} takes no args`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'args must be an object'
  return parser(asRecord(raw))
}
