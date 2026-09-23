# Issue #142: opponents' public hand

- **Slug:** `issue-142-public-hand`
- **Branch:** `feat/issue-142-public-hand`
- **Owner:** Codex
- **Status:** done

## Goal

Players and spectators can inspect each player's public hand as one face-down card per culture card, hut, village, great person, and unit. The view shows category and count without revealing card identity.

## Why

Issue #142 asks: "Should be able to see players open knowledge hand. - Face down culture cards, huts, villages, GP cards and units". The human confirmed one card back per item, grouped per player. The current game view shows only the viewer's own hand, while opponents expose one aggregate hand count.

## Scope

**In:**

- Project only safe, per-category hand counts for the five listed categories.
- Show a read-only face-down public hand for every opponent, including to spectators and in revision replay.
- Keep the owner's existing hand and actions intact.

**Out:**

- Revealing card names, IDs, numbers, front artwork, stats, or ordering. Face-down cards cannot disclose those.
- Changing draws, trades, reveals, or other game actions.

## Reference

The old Java `GameAction.mapGameDTO` returned only the viewer's `Playerhand`, and the old AngularJS `game.html` showed "My Items" privately. It did not have an opponent public-hand panel. This is a new display feature requested in issue #142; `OpaquePlayerhand` already establishes counts-only projection behavior.

## Approach

Extend `OpaquePlayerhand` in `packages/engine/src/state.ts` with five counts derived from `player.items`. Add a read-only opponent public-hand component to the game page, using generic face-down cards rather than item data or front artwork. Use current view data so history replay follows the selected revision.

## Claimed paths

- `packages/engine/src/state.ts`
- `packages/engine/test/hidden-info.test.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/OpponentHandPanel.tsx`
- `packages/web/src/views/OpponentHandPanel.test.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/issue-142-public-hand.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`
- `README.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [x] Each opponent's listed categories show one face-down card per item and are read-only.
- [x] A spectator can see the same public counts; an owner still sees their own cards and controls.
- [x] Changing/replaying a view updates the public hand.
- [x] Projection tests prove item identities, numbers, art, and other private fields remain hidden.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [x] Verified in a local two-player game as a signed-out spectator: five card backs appeared; rewinding one revision removed the unit back.

## Open questions

None. The human confirmed one card back per item.
