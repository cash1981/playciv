# Issue 116 - Hut and Village are not a finite resource

- **Slug:** `issue-116-hut-village-unlimited`
- **Branch:** `fix/issue-116-hut-village-unlimited`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The board palette must not cap Huts and Villages by the number of players.

`boardAssetLimit` treats every `resources/*` board asset the same way, returning
`Math.max(0, Math.min(5, numOfPlayers))`. With two players the palette therefore
shows "Hut (2)" and "Village (2)" and a third such piece is refused. A Hut or
Village is picked up during play - a scout discovers it, loot moves it between
players - not dealt from a finite setup supply, so there is no physical maximum
to enforce. Both must be unlimited: no count beside the palette entry and no
`BOARD_ASSET_LIMIT_REACHED`.

Wheat, iron, silk and incense keep the player-count cap issue #49 introduced.

## Why

Issue #116: *"It has max (2) on it now. That should not be applied for hut and
villages."* The finite-supply rule came from issue #49 as a requested
improvement, not from the old backend or client, so the owner is the authority
for which pieces it covers (the same situation as the culture track and the
starting-tile orientation).

## Scope

**In:**

- `boardAssetLimit` returns `undefined` (unlimited) for `resources/hut` and
  `resources/village`; every other resource is unchanged.
- An engine test proving the two assets have no limit, that the palette count
  is `undefined`, and that placing several of each succeeds.
- A web test proving the palette renders no count and stays draggable.

**Out:**

- Any change to the four real resources, buildings, Great Persons, placement or
  removal, or the palette's rendering code. The palette already hides the count
  whenever `remainingBoardAssetCount` returns `undefined`.
- Changing the manifest category: hut and village are still resource pieces.

## Approach

Keep the limit a pure derivation in the engine. Add a small named set of
resource ids that carry no physical cap and consult it inside the existing
`resource` branch of `boardAssetLimit`. `remainingBoardAssetCount` already
short-circuits to `undefined` for an unlimited asset, and `BoardPalette` already
omits the `(n)` suffix and the exhausted state for an undefined count, so no
client change is needed beyond the test.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/test/board.test.ts`
- `packages/web/src/views/BoardView.test.tsx`
- `docs/agents/tasks/issue-116-hut-village-unlimited.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`
- `README.md`

## Acceptance criteria

- [ ] `boardAssetLimit(resources/hut, n)` and `boardAssetLimit(resources/village, n)` are `undefined` for every player count.
- [ ] Wheat, iron, silk and incense keep the player-count limit.
- [ ] Six huts and six villages can be placed in a two-player game through `placePiece`.
- [ ] The palette shows no count for a hut and does not disable it.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] No hidden information is touched; no `PlayerView` change.
