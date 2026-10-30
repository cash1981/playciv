# Battle aftermath: last arena stays visible, returning a unit undoes its arrival

- **Slug:** `battle-aftermath` · **Branch:** `feat/battle-aftermath` · **Owner:** Claude (Opus 5.5) · **Status:** in review

## Goal

1. After "End battle" the arena must not vanish: "it becomes impossible for the
   last player to see what the final state looked like". The final arena stays
   visible, read-only, until someone starts a new battle (human chose option A).
2. Bug: a killed unit was replaced by a newly placed unit, whose face-off killed
   the opposing unit. Returning the new unit to hand left the fallen unit gone
   and the opponent dead. Taking a unit back must restore what its arrival did.

## Scope

**In:** a public `lastBattle` projection of `endedBattle`; a read-only final
arena with result in the Battle panel; undoing an arrival's displacement and
face-off when the unit is returned to hand or moved off that front.

**Out:** a general per-action undo stack for the arena; battle history beyond
the latest battle; unit names in the end-of-battle log line.

## Reference

`decisions.md` → Battles (undo End battle, kills are flags). Source:
`packages/engine/src/actions/arena.ts`, `state.ts` (`toPlayerView`),
`battle.ts`, `migrate.ts`; web `GameView.tsx` (`BattlePanel`, `ArenaRow`).

## Approach

- Engine: `ArenaUnit.arrival` records the slot id of the fallen unit it
  displaced and the face-off's before/after vitals of both units. Return to
  hand and a move off the front revert them, but only for a unit whose vitals
  still equal what the face-off left. Migration backfills `arrival: null`.
- Projection: `lastBattle` holds labels, summaries frozen at End battle, winner and the arena with
  every id replaced by a positional one; no `departedUnits`, no card ids.
- Web: the "Battle ended" banner shows the result and a read-only arena.

## Claimed paths

- `packages/engine/src/actions/arena.ts`, `battle.ts`, `state.ts`, `migrate.ts`
- `packages/engine/test/arena.test.ts`, `chat-orders-turns.test.ts`
- `packages/web/src/views/GameView.tsx`, `ItemCard.tsx` and their `*.test.tsx`
- `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Returning the reinforcing unit restores the fallen unit and the opponent
- [ ] Moving it off that front does the same; manual edits are never overwritten
- [ ] Every viewer sees the final arena and result until a new battle starts
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: no card id, slot id, battle id or departed unit in
      `lastBattle` for any viewer, and no slot or battle id anywhere in the
      view (an opponent's battlehand is public by design)
- [ ] Browser check: end a battle and see the final arena; replay the bug
