# Arena: face units across the table; reinforce a fallen unit's front

- **Slug:** `issue-74-arena-facing-reinforce`
- **Branch:** `fix/issue-63-arena-ux` (continuation of the still-open PR #67)
- **Owner:** Claude (Sonnet 5)
- **Status:** done

## Goal

Two fixes from [issue #74](https://github.com/cash1981/playciv/issues/74),
found retesting PR #67:

1. Arena cards should visually face each other across the table, like the
   physical board game — the attacker's row and the defender's row currently
   both render "upright" the same way instead of facing one another.
2. Once a unit is killed, a new unit should be placeable on the same front to
   keep fighting whatever is still opposing it. Today the position stays
   blocked (`ARENA_POSITION_OCCUPIED`) until the whole battle ends.

## Why

Direct feedback retesting PR #67 in the browser. No old-system reference —
new arena presentation and interaction (see `docs/agents/decisions.md`).

## Approach

- **1 (facing).** `ItemCard`'s `rotation` prop is now a plain `number`
  instead of the engine's `Rotation` union, since a caller may add a base
  orientation on top of the stored value and the sum need not itself be a
  named angle. `ArenaUnitCard` computes
  `(unit.rotation + (unit.side === 'attacker' ? 180 : 0)) % 360` — the
  attacker's row renders on top of the arena frame, so its cards get a base
  180° so they face the defender's row below, on top of whatever level the
  player has rotated to. Purely a CSS transform; `unit.rotation` itself
  (used for the attack/health suggestion) is untouched.
- **2 (reinforcement).** `placeUnitInArena` and `moveArenaUnit` now only
  treat a front as occupied if a *living* unit is on it
  (`!u.killed`) — a killed unit no longer blocks its own front. When a new
  or moved unit lands on a front still holding a killed one, that killed
  unit's source card is finalized immediately: discarded via a new shared
  `discardKilledArenaUnit` helper (extracted from `endBattleAction`, same
  discard-convention-matching and `DISCARD` logging), and removed from
  `battle.arena`. This is the natural second commit point for a kill,
  alongside "the battle ends" — reinforcing a front is exactly the moment
  there is no longer a slot to undo the kill back into, so it stops being
  undoable at that point rather than at battle-end.

## Claimed paths

- `packages/web/src/views/ItemCard.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/engine/src/actions/arena.ts`
- `packages/engine/test/arena.test.ts`
- `packages/server/test/api.test.ts`

## Acceptance criteria

- [ ] The attacker's arena cards render upside down relative to the
      defender's, so the two rows visually face each other.
- [ ] Placing a new unit on a front that only holds a killed unit succeeds;
      the killed unit's card is discarded and it is no longer in the arena.
- [ ] Moving an existing unit onto such a front behaves the same way.
- [ ] The click-to-place fallback (not just drag-and-drop) can also
      reinforce a front held only by a killed unit.
- [ ] A front with a still-living unit remains blocked as before.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
