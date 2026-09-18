# Battle Arena

- **Slug:** `issue-63-battle-arena`
- **Branch:** `feat/issue-63-battle-arena`
- **Owner:** Claude (Sonnet 4.6)
- **Status:** in progress

## Goal

Players can initiate a head-to-head battle inside the Battle panel: choose an
opponent (another player or barbarians), drag units from their battlehand into a
shared arena with explicit fronts, track attack/health per unit manually (because
units can be upgraded without new artwork), see a live summary of remaining HP
and combat bonus per side, kill units with a button, flip the battle turn back
and forth, and end the battle cleanly. The existing draw-battlehand mechanics
stay intact for standalone use (e.g. Oracle reveal, random unit draws).

Auto-refresh (every 30 s, toggle in the top-right corner) is added to the whole
game view so players who are watching a battle in near-real-time do not have to
reload manually.

## Why

The battle panel today only draws and reveals units. Issue #63 adds the arena
coordination layer that lets two players actually play out a combat in the forum
game. The old Java backend left battle as an open TODO and never implemented it.

## Scope

**In:**

- `GameState.battle: Battle | null` — one active battle per game at a time.
- `GameState.rev: number` — monotone version counter; prevents last-write-wins
  data loss when two players act on the arena simultaneously (409 Conflict on
  mismatch).
- Engine reducers: `initiateBattle`, `placeUnitInArena`, `setArenaUnitStat`,
  `killArenaUnit`, `endBattleTurn`, extended `endBattle`.
- `BattleSide`, `ArenaUnit`, `Battle` types in a new `battle.ts`.
- `PlayerView` gains `battle` (the current arena, or null) and `battleSummary`
  (derived totals per side — unit count, total HP, total attack, combat bonus).
- New error kinds: `BATTLE_ALREADY_ACTIVE`, `NO_BATTLE_ACTIVE`,
  `NOT_IN_THIS_BATTLE`, `UNIT_ALREADY_IN_BATTLE`, `ARENA_UNIT_NOT_FOUND`,
  `INVALID_ARENA_STAT_VALUE`, `CANNOT_BATTLE_YOURSELF`.
- Server routes at `/api/games/:gameId/battle/arena/*`.
- Web: the existing `BattlePanel` (`CollapsiblePanel id="battle"`) is extended
  downward — no new panel. Arena shows below the battlehand. Drag-and-drop from
  battlehand cards to arena fronts. Kill button per arena unit. Battle turn
  marker. End battle turn + end battle buttons.
- Auto-refresh toggle (30 s) in the game-view top-right.

**Out:**

- Websockets / SSE / server-push — deferred; a 30 s poll and a Refresh button
  cover the need for now.
- Undo of arena actions — the log is the record; board-style undo would need a
  separate history structure.
- Unit upgrades / tech modifiers applying automatically — units can be upgraded
  without new artwork, so attack and health in the arena are always manually
  entered. The card image reflects the base card; the arena stats are
  user-supplied.
- Enforcement of whose battle turn it is server-side — advisory only (greyed-out
  button client-side), consistent with how `NOT_YOUR_TURN` works today (one
  call site, rarely enforced). Noted in decisions.md.

## Reference

This feature is entirely new — the old Java backend left battle as `// TODO:
Need to decide how to proceed with battle` in `requirements.txt`. There is no
reference implementation.

Existing code used:
- `packages/engine/src/item.ts` — `UnitItem`, `UnitBase` (already has `attack`,
  `health`, `killed`, `inBattle`; `inBattle` and `killed` are currently always
  `false` — this feature is what finally sets them).
- `packages/engine/src/actions/draw.ts` — `drawUnitsForBattle`,
  `revealAndDiscardBattlehand`, `endBattle`, `drawBarbarians`.
- `packages/engine/src/actions/player.ts` — `setPlayerStat` pattern for
  `setArenaUnitStat`.
- `packages/engine/src/state.ts` — `Playerhand.battlehand`,
  `Playerhand.barbarians`, `toPlayerView`.
- `packages/web/src/views/GameView.tsx` — `BattlePanel` (extended in place).

## Approach

### Engine (`packages/engine/src/`)

**`battle.ts`** (new) — types only:

```ts
export type BattleSideId = 'attacker' | 'defender'

export interface BattleSide {
  readonly kind: 'player' | 'barbarians'
  /** Who acts for this side. For barbarians: player to attacker's left. */
  readonly playerId: string
}

export interface ArenaUnit {
  readonly id: string            // from UnitItem.id
  readonly side: BattleSideId
  /**
   * Which column. Explicit integer so killing a unit leaves a gap rather than
   * silently re-pairing survivors behind it.
   */
  readonly position: number
  readonly unit: UnitItem        // snapshot at placement (for card image)
  readonly attack: number        // user-entered (seeds from card value)
  readonly health: number        // user-entered current HP
  readonly placedBy: string      // playerId
}

export interface Battle {
  readonly id: string
  readonly attacker: BattleSide
  readonly defender: BattleSide
  readonly turn: BattleSideId    // advisory — not enforced server-side
  readonly arena: readonly ArenaUnit[]
}
```

**`state.ts`** — add to `GameState`:
- `readonly battle: Battle | null`
- `readonly rev: number` (starts at 0, incremented by every `applyToGame`)

Add to `PlayerView`:
- `readonly battle: Battle | null` (the arena is public — both sides can see all)
- `readonly battleSummary: readonly BattleSideSummary[]` (derived, 2 entries when
  battle active)

`BattleSideSummary`:
```ts
{ side: BattleSideId; label: string; unitCount: number;
  totalHealth: number; totalAttack: number; combatBonus: number }
```

**`migrate.ts`** — add `battle: null` and `rev: 0` for states that predate
this feature.

**`actions/arena.ts`** (new) — all reducers:

| Reducer | Key logic |
|---|---|
| `initiateBattle(state, {initiatorId, opponentId\|'barbarians'})` | Errors if `state.battle !== null`; for barbarians draws 3 automatically (reuse `drawBarbariansForPlayer`), sets `turn: 'attacker'`. |
| `placeUnitInArena(state, {playerId, unitId, side, position, attack, health})` | Finds unit in `battlehand` (player side) or `barbarians` (barbarian side); errors if `unit.inBattle`; sets `inBattle: true` on source; appends `ArenaUnit`; does NOT flip turn. |
| `setArenaUnitStat(state, {playerId, arenaUnitId, key: 'attack'\|'health', value})` | Any game member may call. Validates non-negative integer. Logs editor + old→new. |
| `killArenaUnit(state, {playerId, arenaUnitId})` | Removes from `arena`; does NOT set `killed: true` on the source card (see `decisions.md` — players manage their own discards). Logs the kill publicly. |
| `endBattleTurn(state, {playerId})` | Flips `turn`. Logs. |
| `endBattle(state, {playerId})` (extends existing) | If `battle !== null`: clears `inBattle` on all arena units' source cards across both sides, sets `battle: null`; does NOT clear `killed`. If `battle === null`: existing behaviour (clear `inBattle` on caller's hand). |

**`errors.ts`** — add new kinds.

**`index.ts`** — re-export `Battle`, `ArenaUnit`, `BattleSide`, `BattleSideId`,
`BattleSideSummary`.

### Server (`packages/server/src/`)

**`routes/arena.ts`** (new) — mounted in `app.ts`:

```
POST /api/games/:gameId/battle/arena/initiate    { opponentId | 'barbarians' }
POST /api/games/:gameId/battle/arena/place       { unitId, side, position, attack, health }
PATCH /api/games/:gameId/battle/arena/:unitId    { key, value }
POST /api/games/:gameId/battle/arena/:unitId/kill
POST /api/games/:gameId/battle/arena/turn/end
```

All routes are auth-gated. `applyToGame` (context.ts) increments `rev` and
returns 409 if the client-supplied `rev` (from the last `PlayerView` response)
does not match the stored one.

**`errors.ts`** — map new error kinds to HTTP status codes.

### Web (`packages/web/src/`)

**`lib/api.ts`** — add methods for all new routes. All responses are
`PlayerView`; the arena state flows back in the same envelope.

**`views/GameView.tsx`** — extend `BattlePanel` in place:

1. Initiate section (only when no battle active): «Initiate battle» button →
   modal/inline select: opponents + «Barbarians».
2. Arena section (only when battle active): battle turn indicator; two-column
   layout (attacker left, defender right); per-column: card image, name, attack
   field, health field, Kill button; summary row (total HP + combat bonus) at
   top of each column; «End battle turn» and «End battle» buttons.
3. Battlehand section (always): drag sources; dragging a card to a arena column
   fires `placeUnitInArena`. Click-to-deploy as fallback (for touch / a11y).
4. Drag-and-drop: HTML5 drag events on `ItemCard`; drop target is a column
   slot. On drop: open inline form for attack/health (pre-filled from card),
   confirm → API call.

**Auto-refresh** — in `GameView` (the root game component): a `useEffect` that
starts/stops a 30 s interval calling `reloadView()`; toggle state persisted in
`localStorage` so the setting survives navigation. A small button in the
game-view header (⟳ Auto-refresh / ⟳ Auto-refresh on).

**`styles.css`** — arena layout, column styling, summary bar, drag-over
highlight, battle-turn indicator.

## Claimed paths

- `packages/engine/src/battle.ts` (new)
- `packages/engine/src/actions/arena.ts` (new)
- `packages/engine/src/state.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/src/index.ts`
- `packages/server/src/routes/arena.ts` (new)
- `packages/server/src/app.ts`
- `packages/server/src/errors.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/styles.css`
- `packages/engine/test/arena.test.ts` (new)
- `packages/server/test/api.test.ts`

## Acceptance criteria

- [ ] A player can initiate a battle against another player or barbarians.
- [ ] Initiating against barbarians draws 3 barbarian units automatically; the
      player to the attacker's left is the barbarian controller.
- [ ] A unit from the battlehand can be dragged to a front in the arena; it is
      marked `inBattle` and cannot be placed again.
- [ ] Attack and health in the arena are manually entered (seeded from card
      values but editable); any game member can edit them; every change is logged.
- [ ] A unit can be killed (removed from the arena); the source card stays in
      the player's hand/barbarians — killed cards are NOT auto-discarded (players
      manage that themselves; revival cards exist).
- [ ] Battle turn flips when «End battle turn» is pressed; the turn marker is
      visible and updates immediately.
- [ ] Summary (unit count, total HP, combat bonus) is shown per side and updates
      on every state change.
- [ ] «End battle» clears the arena and resets `inBattle` on all involved units.
- [ ] The existing battlehand draw, reveal and barbarian mechanics work unchanged
      when no battle is active.
- [ ] Concurrency: a `rev` mismatch returns 409 (tested with two concurrent
      writes in a server test).
- [ ] Auto-refresh toggle works; interval fires every 30 s; setting survives
      navigation (localStorage).
- [ ] Hidden information: the arena is public — both sides see all arena units.
      Units NOT in the arena remain subject to existing hidden-info rules. Test
      confirms no hidden hand cards leak via the `battle` field.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

All resolved before implementation started. Decisions recorded in
`docs/agents/decisions.md`.
