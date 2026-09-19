# Battle arena: turn order, rotate stats, kill/move undo, panel state

- **Slug:** `issue-71-arena-undo`
- **Branch:** `fix/issue-63-arena-ux` (continuation, per the human's request —
  same branch as issues #63, #65 and #68)
- **Owner:** Claude (Sonnet 5)
- **Status:** done

## Goal

Fix five problems from [issue #71](https://github.com/cash1981/playciv/issues/71),
found retesting PR #67:

1. The battle turn opened with the attacker (the one who started the fight);
   it should open with the defender (the one being attacked reacts first).
   Also: a collapsible panel's open/closed state should survive a page
   reload.
2. Rotating an arena unit changed its attack/health but the card's own
   displayed name/number stayed frozen at the printed values, so it looked
   like nothing changed.
3. After a page refresh, a unit killed in the arena reappeared in the
   owner's hand.
4. After placing a unit, the player should be able to move it to a different
   front or pull it back to hand — only locked in once the battle actually
   ends. Repeated adjustments to the same unit should collapse to one log
   line.
5. Killing a unit should be undoable up until the battle ends — there was no
   way back except refreshing without saving.

## Why

Direct feedback retesting PR #67 in the browser. No old-system reference —
entirely new arena behaviour (see `docs/agents/decisions.md`).

## Approach

- **1a (turn order).** `initiateBattle` now sets `turn: 'defender'` in both
  branches (player-vs-player and vs-barbarians).
- **1b (panel state).** `CollapsiblePanel` now persists `open` to
  `localStorage` under `civ.panel.<id>`, read once on mount as the initial
  state (falling back to `defaultOpen` the first time an id is seen) and
  written on every change. Applies to every panel that uses the component,
  not just the battle ones.
- **2 (rotate display).** `ItemCard` gained a `labelOverride` prop: the
  caption text can be replaced without touching `item`, so `ArenaUnitCard`
  can show the live attack/health without changing which image is looked
  up. (First attempt cloned the card with `attack`/`health` overridden and
  passed that to `ItemCard` — broke the art, since `itemImage()` derives the
  filename from those same fields and most rotated/edited combinations have
  no matching file on disk. See `decisions.md`.)
- **3 (killed unit reappearing) and 5 (undoable kill).** These turned out to
  be the same design fix. `ArenaUnit` gains `killed: boolean`.
  `killArenaUnit` no longer removes the unit from the arena or touches
  `inBattle` — it toggles `killed` (call again to undo), staying a
  participant-only action per issue #65. `battleSummaries` excludes killed
  units from unit-count/attack/health totals, since they are dead but still
  present for undo purposes. Only `endBattleAction` makes it final: a unit
  still `killed` when the battle ends has its source card **discarded**
  (moved to `discardedItems`, removed from hand/items) instead of being
  returned; every other unit's source card gets `inBattle` cleared as
  before. This is why the card no longer reappears — the reappearing bug
  and "no undo" complaint were two symptoms of the same missing state
  (kill had no in-between state between "in the arena" and "gone").
- **4 (move / return to hand).** Two new reducers, both restricted to the
  unit's own side (same as `placeUnitInArena`, stricter than the
  any-participant rule on kill/stat-edit):
  - `moveArenaUnit` — changes `position` on an already-placed unit, same
    `ARENA_POSITION_OCCUPIED` check as placing.
  - `returnArenaUnitToHand` — the "×" button; removes the arena entry and
    clears `inBattle`, i.e. undoes `placeUnitInArena` outright.
  Web: dragging an already-placed card (now `draggable` when it is the
  viewer's own side) moves it; a "× Return to hand" button undoes the
  placement. Dropping on the wrong side's row is a no-op rather than
  repositioning the unit on its own side by mistake. `onDragEnd` clears the
  drag-tracking state on both hand and arena cards, so a drag released
  outside any slot cannot leave a stale id to hijack the next unrelated
  drag. "Only log the last change" is a new `appendRollingArenaLog` helper
  (in `arena.ts`): if the immediately preceding log entry matches a
  caller-supplied predicate (same kind of adjustment on the same card, by
  message text), it is dropped before the new one is appended. Used by
  `moveArenaUnit` and `killArenaUnit`'s two directions; scoped to the
  single most recent entry, not a general log rewrite. It never sets
  `item` on these entries — an earlier version did, which made them
  reachable through the undo system (`initiateUndo`'s only gate is
  `entry.item !== null`) and would have corrupted the game on an accepted
  undo. See `decisions.md`.

## Claimed paths

- `packages/engine/src/battle.ts`
- `packages/engine/src/actions/arena.ts`
- `packages/engine/src/state.ts` (`battleSummaries` only)
- `packages/engine/src/migrate.ts`
- `packages/engine/test/arena.test.ts`
- `packages/server/src/routes/arena.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/CollapsiblePanel.tsx`
- `packages/web/src/lib/api.ts`

## Acceptance criteria

- [ ] A newly initiated battle's turn is `'defender'`, for both a player
      opponent and barbarians.
- [ ] Collapsing/expanding any panel survives a page reload.
- [ ] Rotating an arena unit changes what the card itself displays, not just
      the ATK/HP inputs below it — and the card art never goes blank, for
      any attack/health combination.
- [ ] Killing a unit does not remove it from the arena or clear `inBattle`;
      calling kill again undoes it. A killed unit does not count in
      `battleSummary` totals.
- [ ] Ending a battle with a unit still killed discards that unit's source
      card; every other unit returns to hand as before.
- [ ] A placed unit can be moved to a different front, or returned to hand,
      any time before the battle ends.
- [ ] Repeated moves (or kill/undo-kill pairs) of the same unit do not pile
      up in the log.
- [ ] No arena log entry (place aside — that one already carried the card
      before this change) is undoable through `initiateUndo`.
- [ ] Dropping a dragged unit on the opposing side's row is a no-op.
- [ ] Releasing a drag outside any arena slot does not affect the next
      unrelated drag-and-drop.
- [ ] A killed unit's discard on end-battle matches its source list's own
      convention (barbarian: `ownerId: null`; player card: `hidden: true`)
      and is logged as a `DISCARD`.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
