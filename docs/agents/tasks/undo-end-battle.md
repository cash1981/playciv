# Undo "End battle"

- **Slug:** `undo-end-battle`
- **Branch:** `feat/undo-end-battle`
- **Owner:** Claude (Sonnet 5.5)
- **Status:** done

## Goal

A player pressed "End battle" by accident and the arena was gone with no way
back. Let the player who ended the battle undo it, and keep ending a battle
free of any new information leaking, since the end can now be reversed.

## Decisions from the human (2026-10-08)

- Undo needs **no vote**. Only the player who pressed End battle may undo it.
- It stays available until a new battle is initiated; other game actions do not
  expire it. Only the battle part is undoable, nothing else.
- The undo control is a banner in the place where the arena was.
- HP and winner info in the log may stay. If a unit would be revealed in the log
  by ending a battle, remove it. (Today `endBattleAction` writes no unit names;
  the arena is already public. Keep it that way and prove it with a test.)

## Approach

- Engine: add `endedBattle: { battle: Battle; endedBy: string } | null` to
  `GameState` (default `null`; `create-game.ts`, `migrate.ts` for old saves).
  `endBattleAction` stores the snapshot it is about to discard. `initiateBattle`
  clears it.
- New reducer `undoEndBattle(state, { playerId })` in `actions/arena.ts`:
  - errors: no snapshot (`NO_BATTLE_TO_UNDO`), a battle is already active, or the
    caller is not `endedBy` (`NOT_IN_THIS_BATTLE` or a new error kind in
    `errors.ts`).
  - restores `battle` from the snapshot, sets `inBattle: true` again on the source
    card of every unit in `arena` and `departedUnits` that still exists (hand
    `items` + `battlehand`, or `barbarians`), clears `endedBattle`, appends a
    public log line "undoes ending the battle". Never sets `item` on the log
    entry (see `initiateUndo`'s gate, issue #71 notes in `decisions.md`).
  - does not touch the earlier "ends the battle" log line; it may stay.
- Projection (`PlayerView`): expose only `battleUndo: { endedBy: string } | null`,
  not the snapshot. Test that nothing else from the snapshot reaches any view,
  and that ending a battle puts no unit name in the public log.
- Server: `POST /api/games/:id/battle/end/undo` in `routes/arena.ts`, same rev
  handling as the other arena routes. Mailing: none.
- Web: `api.undoEndBattle(gameId, rev)`; in `GameView.tsx`, when `battle === null`
  and `battleUndo !== null`, show a "Battle ended — Undo" banner where the arena
  was. The Undo button renders only for `battleUndo.endedBy === me`.

## Claimed paths

- `packages/engine/src/actions/arena.ts`
- `packages/engine/src/state.ts` (`GameState`, `PlayerView`, `toPlayerView`)
- `packages/engine/src/errors.ts`
- `packages/engine/src/create-game.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/src/index.ts`
- `packages/engine/test/arena.test.ts`
- `packages/server/src/routes/arena.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/GameView.test.tsx`

## Acceptance criteria

- [ ] Ending a battle then undoing it restores the same arena, turn and units,
      and the source cards are `inBattle` again.
- [ ] Only the player who ended the battle can undo; another participant and a
      non-participant get an error and the state is unchanged.
- [ ] Undo is rejected once a new battle has been initiated, and initiating a
      battle clears the undoable snapshot.
- [ ] Undo works for barbarian battles and for reinforced (`departedUnits`) units.
- [ ] A source card discarded or removed between end and undo does not crash
      the undo; it is simply skipped.
- [ ] `battleUndo` in the view exposes `endedBy` only; leak test added.
- [ ] Ending a battle logs no unit name.
- [ ] Old saved games without `endedBattle` load (migration test).
- [ ] Banner shows after End battle and the Undo button only for `endedBy`.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
