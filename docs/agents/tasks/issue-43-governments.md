# Governments in player status

- **Slug:** `issue-43-governments`
- **Branch:** `feat/issue-43-governments`
- **Owner:** Codex
- **Status:** in progress

## Goal

Every player row in Player status shows the civilization's current government.
Any game member can change it from a fixed dropdown, and every player and
spectator can read the eight Wisdom and Warfare government cards in the same
panel without opening the retired asset spreadsheet.

## Why

Issue #43 replaced the old asset spreadsheet, but deliberately left Government
open. The human asked to "do it basic, by just adding a dropdown on player
status," while also showing the government information so players can read what
the cards do.

## Scope

**In:**

- Persist one public government value per player and migrate older games to
  Despotism.
- Set the documented starting-government exceptions when a civilization is
  chosen: Rome starts in Republic, Russia in Communism, and Japan in Feudalism.
- Let any current game member edit any current player's government, with a
  public log entry, through a pure reducer and an authenticated API route.
- Add a Government dropdown to each Player status row.
- Show a readable reference for all eight replacement government cards in the
  Player status panel.
- Keep spectators and historical revisions read-only.

**Out:**

- Enforcing government unlocks, the one-turn direct-change window, forced
  Anarchy, or government card effects. The old application treated government
  as shared manual spreadsheet bookkeeping, and the current status board does
  the same.
- Modelling government cards as deck `Item`s. They are public player aids, not
  drawn or discarded items and have no hidden-information or item-number
  behaviour.

## Reference

The old application had no government field, reducer or endpoint. Players
tracked it manually in the per-game Google Sheet embedded by
`old-civ-web/app/views/partials/asset.html`; the Angular client refreshed the
read-only iframe every 60 seconds and linked to the editable sheet.

The official core rules, `Civilization/civilization-rules.pdf` pages 11-14,
define Despotism as the normal start, with Rome in Republic and Russia in
Communism. `Civilization/CI03_WW_Rulebook.pdf` pages 4-5 replaces the core
government cards and adds Japan's Feudalism start. The eight replacement cards
are pictured in `Civilization/WaW/government.jpg`.

## Approach

- Add a shared `Government` union, card catalogue, and starting-government
  helper in a small engine module.
- Add `government` directly to `Playerhand` and its public/owner projections,
  separate from numeric `PlayerStats`; default and backfill it in game creation
  and migration.
- Apply the civilization-specific starting government when choosing a
  civilization, before later manual edits are possible.
- Add `setPlayerGovernment`, parallel to `setPlayerStat`, with membership and
  whitelist validation and public logging.
- Expose a dedicated player-government route and typed web API call.
- Render the dropdown and semantic card-reference grid in `StatusPanel`; use
  card text rather than treating the old tech-card PNGs as government art.

## Claimed paths

- `docs/agents/tasks/issue-43-governments.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`
- `packages/engine/src/government.ts`
- `packages/engine/src/state.ts`
- `packages/engine/src/create-game.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/src/actions/player.ts`
- `packages/engine/src/actions/game.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/src/index.ts`
- `packages/engine/test/player-government.test.ts`
- `packages/engine/test/hidden-info.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/src/errors.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/StatusPanel.test.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [ ] New and migrated players have a valid government.
- [ ] Rome, Russia and Japan receive their documented starting governments when
      their civilization is chosen; other civilizations receive Despotism.
- [ ] Any game member can change any current player's government to one of the
      eight allowed values, and the public log identifies editor, target and
      value.
- [ ] Non-members and invalid government strings cannot mutate the game.
- [ ] Player status shows an editable dropdown to members and a disabled one to
      spectators/replay viewers.
- [ ] The same panel contains readable information for all eight government
      cards.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: adding government to public projections does not add
      any private hand, private log or unrevealed-tech data; the existing
      serialized projection test remains passing and asserts the public field.
- [ ] Verified in the browser: changing a government updates the row and public
      log; the reference cards are readable at desktop and narrow widths; a
      spectator cannot edit.

## Open questions

None. This deliberately remains shared bookkeeping and does not invent rules
enforcement that the old application never had.
