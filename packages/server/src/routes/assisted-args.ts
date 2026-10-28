/**
 * The payload of the assisted actions that carry one in `args` (assisted play,
 * part 13). Each action has its own strict parser: a known shape, ids in the usual
 * safe set, nothing extra. Whether the card, the players or the square are legal is
 * the engine's decision, made from the fresh state.
 *
 * The older actions (`chooseReward`, `build`, `startBuildingProgram`,
 * `upgradeBuildings`) keep their own top-level fields in `play.ts`.
 */

import { isGovernment } from '@civ/engine'
import type {
  AssignScoutPayload,
  AssistedPayload,
  FoundCityPayload,
  GovernmentPayload,
  FeudalismHarvestPayload,
  InvestPayload,
  InvestmentCard,
  PlayCardPayload,
} from '@civ/engine'

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
  const extra = extraKeys(args, ['itemId', 'targets', 'resource', 'coinSource', 'substitute', 'from', 'to'])
  if (extra.length > 0) return `playCard takes only itemId, targets, resource, coinSource, substitute, from and to, not ${extra.join(', ')}`
  if (!isId(args['itemId'])) return 'itemId is required: 1 to 64 characters, letters, digits and . _ : -'
  const targets = args['targets'] === undefined ? [] : args['targets']
  if (!Array.isArray(targets) || targets.length > MAX_TARGETS || !targets.every(isId)) {
    return `targets must be a list of at most ${MAX_TARGETS} player ids`
  }
  const resource = args['resource']
  if (resource !== undefined && (typeof resource !== 'string' || resource.length === 0 || resource.length > 20)) {
    return 'resource must be a short text'
  }
  const coinSource = args['coinSource']
  if (coinSource !== undefined && (typeof coinSource !== 'string' || coinSource.length === 0 || coinSource.length > 30)) {
    return 'coinSource must be a short text'
  }
  const substitute = args['substitute']
  if (substitute !== undefined && (typeof substitute !== 'string' || substitute.length === 0 || substitute.length > 20)) {
    return 'substitute must be a short text'
  }
  const square = (value: unknown, name: string): { readonly column: number; readonly row: number } | string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${name} must be a square`
    const record = asRecord(value)
    const extra = extraKeys(record, ['column', 'row'])
    if (extra.length > 0) return `${name} takes only column and row, not ${extra.join(', ')}`
    const column = record['column']
    const row = record['row']
    if (
      typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column > 999 ||
      typeof row !== 'number' || !Number.isInteger(row) || row < 0 || row > 999
    ) {
      return `${name} needs whole column and row numbers`
    }
    return { column, row }
  }
  const from = square(args['from'], 'from')
  if (typeof from === 'string') return from
  const to = square(args['to'], 'to')
  if (typeof to === 'string') return to
  return {
    itemId: args['itemId'],
    targets,
    ...(resource === undefined ? {} : { resource }),
    ...(coinSource === undefined ? {} : { coinSource }),
    ...(substitute === undefined ? {} : { substitute }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  }
}

function parseSwitchGovernment(args: Record<string, unknown>): GovernmentPayload | string {
  const extra = extraKeys(args, ['government'])
  if (extra.length > 0) return `switchGovernment takes only government, not ${extra.join(', ')}`
  const government = args['government']
  if (typeof government !== 'string' || !isGovernment(government)) return 'government must be a known government'
  return { government }
}

const INVESTMENT_KEYS: readonly InvestmentCard[] = ['infra', 'efta', 'mic', 'pe']

function parseInvest(args: Record<string, unknown>): InvestPayload | string {
  const extra = extraKeys(args, ['source', 'card'])
  if (extra.length > 0) return `invest takes only source and card, not ${extra.join(', ')}`
  const { source, card } = args
  if (typeof source !== 'string' || source.length === 0 || source.length > 30) return 'source must be a short text'
  if (typeof card !== 'string' || !(INVESTMENT_KEYS as readonly string[]).includes(card)) {
    return `card must be one of ${INVESTMENT_KEYS.join(', ')}`
  }
  return { source, card: card as InvestmentCard }
}

function parseHarvest(args: Record<string, unknown>): FeudalismHarvestPayload | string {
  const extra = extraKeys(args, ['cityPieceId', 'resource'])
  if (extra.length > 0) return `feudalismHarvest takes only cityPieceId and resource, not ${extra.join(', ')}`
  const { cityPieceId, resource } = args
  if (!isId(cityPieceId)) return 'cityPieceId is required: 1 to 64 characters, letters, digits and . _ : -'
  if (typeof resource !== 'string' || resource.length === 0 || resource.length > 20) return 'resource must be a short text'
  return { cityPieceId, resource }
}

function parseFoundCity(args: Record<string, unknown>): FoundCityPayload | string {
  const extra = extraKeys(args, ['figurePieceId'])
  if (extra.length > 0) return `foundCity takes only figurePieceId, not ${extra.join(', ')}`
  if (!isId(args['figurePieceId'])) return 'figurePieceId is required: 1 to 64 characters, letters, digits and . _ : -'
  return { figurePieceId: args['figurePieceId'] }
}

function parseAssignScout(args: Record<string, unknown>): AssignScoutPayload | string {
  const extra = extraKeys(args, ['scoutPieceId', 'cityPieceId'])
  if (extra.length > 0) return `assignScout takes only scoutPieceId and cityPieceId, not ${extra.join(', ')}`
  if (!isId(args['scoutPieceId'])) return 'scoutPieceId is required: 1 to 64 characters, letters, digits and . _ : -'
  const city = args['cityPieceId']
  if (city !== null && !isId(city)) return 'cityPieceId must be a piece id, or null to stop sending the square'
  return { scoutPieceId: args['scoutPieceId'], cityPieceId: city }
}

type Parser = (args: Record<string, unknown>) => AssistedPayload | string

/** The actions whose payload is `args`, with the parser of each. A map, so a request can only pick an entry that is here. */
const PARSERS: ReadonlyMap<string, Parser> = new Map<string, Parser>([
  ['playCard', parsePlayCard],
  ['switchGovernment', parseSwitchGovernment],
  ['invest', parseInvest],
  ['feudalismHarvest', parseHarvest],
  ['foundCity', parseFoundCity],
  ['assignScout', parseAssignScout],
])

/** Whether `action` takes `args`. */
export const takesArgs = (action: string): boolean => PARSERS.has(action)

/**
 * The payload of `action` from the body's `args`, or a sentence saying what is
 * wrong with it. `args` must be an object for an action that takes it.
 */
export function parseActionArgs(action: string, raw: unknown): AssistedPayload | string {
  const parser = PARSERS.get(action)
  if (parser === undefined) return `${action} takes no args`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'args must be an object'
  return parser(asRecord(raw))
}
