# Issue 49 — Track available buildings, resources and Great Persons

- **Slug:** `issue-49-availability`
- **Branch:** `feat/issue-49-availability`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

Players can see how many physical building, resource, and Great Person pieces
remain available, and the board refuses placements once a finite supply is
exhausted. Removing a piece returns it to the available pool. Great Persons
are board assets loaded from `Civilization/Moderator/great people`.

## Why

Issue #49 asks for visible and enforced finite supplies: upgrade pairs such as
Barracks/Academy share six pieces, resources scale with player count, and each
Great Person type has a maximum of three. The current board palette allows
unlimited placement and the current board palette does not expose remaining
Great Person availability.

## Scope

**In:**

- Add a pure availability calculation from game state and board pieces.
- Enforce finite placement for buildings and resources, returning a typed engine
  error when a supply is exhausted.
- Make removal/deletion restore availability.
- Show remaining counts beside affected board-palette entries and disable
  placement when no supply remains. The separate Great Person card draw remains
  a deck/hand action and is not part of this physical board-piece supply.
- Cover the limits, upgrade-family sharing, player-count resource limits,
  removal restoration, and the public UI/API behavior with tests.

**Out:**

- Inventing limits beyond the resolved rules below.
- Changing card effects or the board's visual geometry.

## Reference

Issue #49 states that upgraded building families share a total of six pieces.
The listed families are Barracks/Academy, Granary/Aqueduct, Library/University,
Market/Bank, and Temple/Cathedral. It requests resource limits by player count
and three Great Persons per type.

The old backend and item model do not enforce these board-piece limits. The old
client used a Google Sheet for assets; this finite-supply behavior is therefore
a requested improvement, not a direct port.

Resolved decisions: every building asset has a supply of six, including
Harbor, Ironmine, Shipyard, and Tradingpost. Upgrade pairs share their six
pieces. Each resource asset has a supply equal to the player count (2–5).
Each Great Person type has a supply of three; placing one consumes a piece and
removing it restores the supply.

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
- [ ] The UI shows remaining counts and disables exhausted board-palette actions.
- [ ] Great Person availability is represented without leaking hidden card data.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: counts change after placement/removal and exhausted actions are disabled.
- [ ] Hidden information: no opponent hand/card contents are added to public projections.

## Resolved design decisions

- Non-upgradeable buildings are capped at six each.
- Great Persons are board assets, capped at three per type, using the same
  placement/removal accounting as buildings.
