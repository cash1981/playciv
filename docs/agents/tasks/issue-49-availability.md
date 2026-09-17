# Issue 49 — Track available buildings, resources and Great Persons

- **Slug:** `issue-49-availability`
- **Branch:** `feat/issue-49-availability`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

Players can see how many physical building and resource pieces remain available,
and the board refuses placements once a category's finite supply is exhausted.
Removing a piece returns it to the available pool. Great Person availability is
represented consistently with the card/deck model rather than being silently
treated as a board piece.

## Why

Issue #49 asks for visible and enforced finite supplies: upgrade pairs such as
Barracks/Academy share six pieces, resources scale with player count, and each
Great Person type has a maximum of three. The current board palette allows
unlimited placement and the current draw UI does not expose remaining Great
Person availability.

## Scope

**In:**

- Add a pure availability calculation from game state and board pieces.
- Enforce finite placement for buildings and resources, returning a typed engine
  error when a supply is exhausted.
- Make removal/deletion restore availability.
- Show remaining counts beside affected palette/draw entries and disable actions
  when no supply remains.
- Cover the limits, upgrade-family sharing, player-count resource limits,
  removal restoration, and the public UI/API behavior with tests.

**Out:**

- Inventing limits not stated in issue #49; unresolved limits are listed below.
- Changing card effects or the board's visual geometry.
- Treating Great Persons as board pieces; they remain cards in the deck/hand
  model unless the open question is answered differently.

## Reference

Issue #49 states that upgraded building families share a total of six pieces.
The listed families are Barracks/Academy, Granary/Aqueduct, Library/University,
Market/Bank, and Temple/Cathedral. It requests resource limits by player count
and three Great Persons per type.

The old backend and item model do not enforce these board-piece limits. The old
client used a Google Sheet for assets; this finite-supply behavior is therefore
a requested improvement, not a direct port.

## Approach

Keep limits in the engine as named availability rules, derive remaining counts
from `GameState.numOfPlayers` and `state.board.pieces`, and make the existing
`placePiece` reducer reject exhausted supplies. Expose the same derived counts
to the board palette and relevant draw controls without duplicating counters in
mutable state.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/src/actions/board.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/test/board.test.ts`
- `packages/engine/test/board-tiles.test.ts`
- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/styles.css`
- `packages/web/src/lib/api.ts`
- `packages/server/src/routes/board.ts`
- `packages/server/test/board-api.test.ts`
- `docs/agents/tasks/issue-49-availability.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] Building upgrade families share a total of six available pieces.
- [ ] Resources are limited to the player count specified in issue #49.
- [ ] An exhausted supply cannot be placed through the reducer or HTTP API.
- [ ] Removing a placed piece restores one available piece.
- [ ] The UI shows remaining counts and disables exhausted palette actions.
- [ ] Great Person availability is represented without leaking hidden card data.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: counts change after placement/removal and exhausted actions are disabled.
- [ ] Hidden information: no opponent hand/card contents are added to public projections.

## Open questions

- Issue #49 does not state the maximum for non-upgradeable buildings (Harbor,
  Ironmine, Shipyard, Tradingpost). Confirm whether those are also six each or
  use another limit.
- Great Persons are cards, not board pieces in the current model. Confirm
  whether “available” means remaining cards in the Great Person deck (per type)
  or a separate visible inventory that is not tied to drawing.
