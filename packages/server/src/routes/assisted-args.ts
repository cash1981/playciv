/**
 * The payload of the assisted actions that carry one in `args` (assisted play,
 * part 13). Each action has its own strict parser: a known shape, ids in the usual
 * safe set, nothing extra. Whether the card, the players or the square are legal is
 * the engine's decision, made from the fresh state.
 *
 * The older actions (`chooseReward`, `build`, `startBuildingProgram`,
 * `upgradeBuildings`) keep their own top-level fields in `play.ts`.
 */

import { BUILDABLE_BUILDING_IDS, isGovernment, parseResourcePayments, resourceCostOf } from '@civ/engine'
import type {
  ArenaUnitPayload,
  AtomicTheoryPayload,
  AssignScoutPayload,
  AssistedPayload,
  CombustionPayload,
  CommunismPayload,
  GunpowderPayload,
  MonarchyPayload,
  MysticismPayload,
  ProductionBoostPayload,
  ResourcesPayload,
  TargetPlayerPayload,
  SteamPowerPayload,
  FoundCityPayload,
  GovernmentPayload,
  FeudalismHarvestPayload,
  GianniniBuildPayload,
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
  const extra = extraKeys(args, ['itemId', 'targets', 'resource', 'coinSource', 'substitute', 'convert', 'harbors', 'discard', 'units', 'from', 'to', 'figureId', 'figureIds', 'tech'])
  if (extra.length > 0) return `playCard takes only itemId, targets, resource, coinSource, substitute, convert, harbors, discard, units, from, to, figureId, figureIds and tech, not ${extra.join(', ')}`
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
  const convertValue = args['convert']
  let convert: { readonly from: 'trade' | 'culture'; readonly amount: number } | undefined
  if (convertValue !== undefined) {
    const record = typeof convertValue === 'object' && convertValue !== null && !Array.isArray(convertValue) ? asRecord(convertValue) : undefined
    if (
      record === undefined ||
      extraKeys(record, ['from', 'amount']).length > 0 ||
      (record['from'] !== 'trade' && record['from'] !== 'culture') ||
      typeof record['amount'] !== 'number' ||
      !Number.isInteger(record['amount']) ||
      record['amount'] < 1 ||
      record['amount'] > 999
    ) {
      return 'convert needs from (trade or culture) and a whole amount from 1 to 999'
    }
    convert = { from: record['from'], amount: record['amount'] }
  }
  const harborsValue = args['harbors']
  let harbors: readonly { readonly cityPieceId: string; readonly column: number; readonly row: number }[] | undefined
  if (harborsValue !== undefined) {
    const bad = 'harbors must be a list of at most 3 squares, each with cityPieceId, column and row'
    if (!Array.isArray(harborsValue) || harborsValue.length > 3) return bad
    const parsed: { cityPieceId: string; column: number; row: number }[] = []
    for (const entry of harborsValue) {
      const record = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? asRecord(entry) : undefined
      if (
        record === undefined ||
        extraKeys(record, ['cityPieceId', 'column', 'row']).length > 0 ||
        !isId(record['cityPieceId']) ||
        typeof record['column'] !== 'number' || !Number.isInteger(record['column']) || record['column'] < 0 || record['column'] > 999 ||
        typeof record['row'] !== 'number' || !Number.isInteger(record['row']) || record['row'] < 0 || record['row'] > 999
      ) {
        return bad
      }
      parsed.push({ cityPieceId: record['cityPieceId'], column: record['column'], row: record['row'] })
    }
    harbors = parsed
  }
  const discard = args['discard']
  if (discard !== undefined && (!Array.isArray(discard) || discard.length > 20 || !discard.every(isId))) {
    return 'discard must be a list of at most 20 card ids'
  }
  const units = args['units']
  if (
    units !== undefined &&
    (!Array.isArray(units) || units.length > 12 || !units.every((unit) => typeof unit === 'string' && unit.length > 0 && unit.length <= 12))
  ) {
    return 'units must be a list of at most 12 unit decks'
  }
  const tech = args['tech']
  if (tech !== undefined && (typeof tech !== 'string' || tech.length === 0 || tech.length > 60)) {
    return 'tech must be a short text'
  }
  const figureId = args['figureId']
  if (figureId !== undefined && !isId(figureId)) return 'figureId must be a piece id'
  const figureIds = args['figureIds']
  if (figureIds !== undefined && (!Array.isArray(figureIds) || figureIds.length > 12 || !figureIds.every(isId))) {
    return 'figureIds must be a list of at most 12 piece ids'
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
    ...(convert === undefined ? {} : { convert }),
    ...(harbors === undefined ? {} : { harbors }),
    ...(discard === undefined ? {} : { discard: discard as readonly string[] }),
    ...(units === undefined ? {} : { units: units as readonly string[] }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(tech === undefined ? {} : { tech }),
    ...(figureId === undefined ? {} : { figureId }),
    ...(figureIds === undefined ? {} : { figureIds: figureIds as readonly string[] }),
  }
}

function parseCommunism(args: Record<string, unknown>): CommunismPayload | string {
  const extra = extraKeys(args, ['square'])
  if (extra.length > 0) return `communism takes only square, not ${extra.join(', ')}`
  const square = args['square']
  if (typeof square !== 'object' || square === null || Array.isArray(square)) return 'square is required'
  const record = asRecord(square)
  const squareExtra = extraKeys(record, ['column', 'row'])
  if (squareExtra.length > 0) return `square takes only column and row, not ${squareExtra.join(', ')}`
  const column = record['column']
  const row = record['row']
  if (
    typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column > 999 ||
    typeof row !== 'number' || !Number.isInteger(row) || row < 0 || row > 999
  ) {
    return 'square needs whole column and row numbers'
  }
  return { square: { column, row } }
}

function parseCombustion(args: Record<string, unknown>): CombustionPayload | string {
  const extra = extraKeys(args, ['pieceId'])
  if (extra.length > 0) return `combustion takes only pieceId, not ${extra.join(', ')}`
  if (!isId(args['pieceId'])) return 'pieceId is required: 1 to 64 characters, letters, digits and . _ : -'
  return { pieceId: args['pieceId'] }
}

/** The most characters of free text a cancel may carry for what it cancels. */
const MAX_NOTE = 80

/** `resources`: exactly `count` names, each a short text; which names are legal is the engine's call. */
function parseResources(action: string, count: number) {
  return (args: Record<string, unknown>): ResourcesPayload | string => {
    const extra = extraKeys(args, ['resources'])
    if (extra.length > 0) return `${action} takes only resources, not ${extra.join(', ')}`
    const resources = args['resources']
    if (
      !Array.isArray(resources) ||
      resources.length !== count ||
      !resources.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 20)
    ) {
      return `resources must be a list of exactly ${count} resource names`
    }
    return { resources: resources as readonly string[] }
  }
}

/** Gunpowder: exactly two resources, and `obsolete` with a `wonderPieceId` or `destroy` with a `buildingPieceId`, nothing else. */
function parseGunpowder(args: Record<string, unknown>): GunpowderPayload | string {
  const extra = extraKeys(args, ['resources', 'mode', 'wonderPieceId', 'buildingPieceId'])
  if (extra.length > 0) return `gunpowder takes only resources, mode, wonderPieceId and buildingPieceId, not ${extra.join(', ')}`
  const resources = args['resources']
  if (
    !Array.isArray(resources) ||
    resources.length !== 2 ||
    !resources.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 20)
  ) {
    return 'resources must be a list of exactly 2 resource names'
  }
  const mode = args['mode']
  if (mode !== 'obsolete' && mode !== 'destroy') return 'mode must be obsolete or destroy'
  if (mode === 'obsolete') {
    if (args['buildingPieceId'] !== undefined) return 'obsolete takes no buildingPieceId, only wonderPieceId'
    if (!isId(args['wonderPieceId'])) return 'obsolete needs wonderPieceId: the ancient or medieval wonder to disable'
    return { resources: resources as readonly string[], mode, wonderPieceId: args['wonderPieceId'] }
  }
  if (args['wonderPieceId'] !== undefined) return 'destroy takes no wonderPieceId, only buildingPieceId'
  if (!isId(args['buildingPieceId'])) return 'destroy needs buildingPieceId: the building to remove'
  return { resources: resources as readonly string[], mode, buildingPieceId: args['buildingPieceId'] }
}

function parseProductionBoost(action: string) {
  return (args: Record<string, unknown>): ProductionBoostPayload | string => {
    const extra = extraKeys(args, ['cityPieceId'])
    if (extra.length > 0) return `${action} takes only cityPieceId, not ${extra.join(', ')}`
    if (!isId(args['cityPieceId'])) return 'cityPieceId is required: 1 to 64 characters, letters, digits and . _ : -'
    return { cityPieceId: args['cityPieceId'] }
  }
}

/** Horseback Riding names the player who gains 6 trade; Writing, Civil Service and Mass Media may add free text for what is cancelled. */
function parseTargetPlayer(action: string, withNote: boolean) {
  return (args: Record<string, unknown>): TargetPlayerPayload | string => {
    const extra = extraKeys(args, withNote ? ['targetId', 'note'] : ['targetId'])
    if (extra.length > 0) return `${action} takes only ${withNote ? 'targetId and note' : 'targetId'}, not ${extra.join(', ')}`
    if (!isId(args['targetId'])) return 'targetId is required: a player id'
    const note = args['note']
    if (note === undefined) return { targetId: args['targetId'] }
    if (typeof note !== 'string' || note.length > MAX_NOTE) return `note must be text of at most ${MAX_NOTE} characters`
    // The note goes into a public log line: a line break or another control character would break the line, so runs of them become one space
    const clean = note.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
    return clean === '' ? { targetId: args['targetId'] } : { targetId: args['targetId'], note: clean }
  }
}

function parseMysticism(args: Record<string, unknown>): MysticismPayload | string {
  const extra = extraKeys(args, ['targetId', 'source'])
  if (extra.length > 0) return `mysticism takes only targetId and source, not ${extra.join(', ')}`
  if (!isId(args['targetId'])) return 'targetId is required: a player id'
  const source = args['source']
  if (typeof source !== 'string' || source.length === 0 || source.length > 30) return 'source must be a short text'
  return { targetId: args['targetId'], source }
}

function parseArenaUnit(args: Record<string, unknown>): ArenaUnitPayload | string {
  const extra = extraKeys(args, ['arenaUnitId'])
  if (extra.length > 0) return `metalworking takes only arenaUnitId, not ${extra.join(', ')}`
  if (!isId(args['arenaUnitId'])) return 'arenaUnitId is required: 1 to 64 characters, letters, digits and . _ : -'
  return { arenaUnitId: args['arenaUnitId'] }
}

function parseAtomicTheory(args: Record<string, unknown>): AtomicTheoryPayload | string {
  const extra = extraKeys(args, ['mode', 'cityPieceId'])
  if (extra.length > 0) return `atomicTheory takes only mode and cityPieceId, not ${extra.join(', ')}`
  const mode = args['mode']
  if (mode !== 'extraActions' && mode !== 'nuke') return 'mode must be extraActions or nuke'
  if (mode === 'extraActions') return args['cityPieceId'] === undefined ? { mode } : 'extraActions takes no cityPieceId'
  if (!isId(args['cityPieceId'])) return 'nuke needs cityPieceId: the city to destroy'
  return { mode, cityPieceId: args['cityPieceId'] }
}

function parseMonarchy(args: Record<string, unknown>): MonarchyPayload | string {
  const extra = extraKeys(args, ['mode', 'targetId', 'wonderPieceId'])
  if (extra.length > 0) return `monarchy takes only mode, targetId and wonderPieceId, not ${extra.join(', ')}`
  const mode = args['mode']
  if (mode !== 'obsolete' && mode !== 'kill') return 'mode must be obsolete or kill'
  if (mode === 'obsolete') {
    if (args['targetId'] !== undefined) return 'obsolete takes no targetId, only wonderPieceId'
    if (!isId(args['wonderPieceId'])) return 'obsolete needs wonderPieceId: the ancient wonder to disable'
    return { mode, wonderPieceId: args['wonderPieceId'] }
  }
  if (args['wonderPieceId'] !== undefined) return 'kill takes no wonderPieceId, only targetId'
  if (!isId(args['targetId'])) return 'kill needs targetId: the player whose hand loses a unit'
  return { mode, targetId: args['targetId'] }
}

function wholeSquare(value: unknown, name: string): { column: number; row: number } | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${name} is required`
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

function parseSteamPower(args: Record<string, unknown>): SteamPowerPayload | string {
  const extra = extraKeys(args, ['from', 'to'])
  if (extra.length > 0) return `steamPower takes only from and to, not ${extra.join(', ')}`
  const from = wholeSquare(args['from'], 'from')
  if (typeof from === 'string') return from
  const to = wholeSquare(args['to'], 'to')
  if (typeof to === 'string') return to
  return { from, to }
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

function parseGianniniBuild(args: Record<string, unknown>): GianniniBuildPayload | string {
  const extra = extraKeys(args, ['cityPieceId', 'assetId', 'column', 'row'])
  if (extra.length > 0) return `gianniniBuild takes only cityPieceId, assetId, column and row, not ${extra.join(', ')}`
  const { cityPieceId, assetId, column, row } = args
  if (!isId(cityPieceId)) return 'cityPieceId is required: 1 to 64 characters, letters, digits and . _ : -'
  if (typeof assetId !== 'string' || !BUILDABLE_BUILDING_IDS.includes(assetId)) return 'assetId must be one of the buildings'
  if (
    typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column > 999 ||
    typeof row !== 'number' || !Number.isInteger(row) || row < 0 || row > 999
  ) {
    return 'column and row must be whole numbers'
  }
  return { cityPieceId, assetId, column, row }
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
  ['communism', parseCommunism],
  ['steamPower', parseSteamPower],
  ['combustion', parseCombustion],
  ['gunpowder', parseGunpowder],
  ['animalHusbandry', parseProductionBoost('animalHusbandry')],
  ['construction', parseProductionBoost('construction')],
  ['banking', parseProductionBoost('banking')],
  ['plastics', parseProductionBoost('plastics')],
  ['pottery', parseResources('pottery', 2)],
  ['philosophy', parseResources('philosophy', 3)],
  ['horsebackRiding', parseTargetPlayer('horsebackRiding', false)],
  ['writing', parseTargetPlayer('writing', true)],
  ['civilService', parseTargetPlayer('civilService', true)],
  ['massMedia', parseTargetPlayer('massMedia', true)],
  ['mysticism', parseMysticism],
  ['monarchy', parseMonarchy],
  ['metalworking', parseArenaUnit],
  ['atomicTheory', parseAtomicTheory],
  ['switchGovernment', parseSwitchGovernment],
  ['invest', parseInvest],
  ['gianniniBuild', parseGianniniBuild],
  ['feudalismHarvest', parseHarvest],
  ['foundCity', parseFoundCity],
  ['assignScout', parseAssignScout],
])

/** Whether `action` takes `args`. */
export const takesArgs = (action: string): boolean => PARSERS.has(action) || resourceCostOf(action) !== undefined

/**
 * The payload of `action` from the body's `args`, or a sentence saying what is
 * wrong with it. `args` must be an object for an action that takes it.
 */
export function parseActionArgs(action: string, raw: unknown): AssistedPayload | string {
  const parser = PARSERS.get(action)
  const cost = resourceCostOf(action)
  if (parser === undefined && cost === undefined) return `${action} takes no args`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'args must be an object'
  const { payments, ...args } = asRecord(raw)
  const checked = payments === undefined ? undefined : parseResourcePayments(payments, cost)
  if (checked !== undefined && !checked.ok) return checked.error
  const parsed = parser === undefined
    ? Object.keys(args).length === 0 ? {} : 'args does not belong to this action'
    : parser(args)
  if (typeof parsed === 'string') return parsed
  return checked === undefined ? parsed : { ...parsed, payments: checked.value }
}
