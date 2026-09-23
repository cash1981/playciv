# Issue #97 follow-up: improve the join color picker

- **Slug:** `issue-97-color-picker-popup`
- **Branch:** `feat/issue-97-color-picker-popup`
- **Owner:** Codex
- **Status:** done; PR #158

## Goal

Joining a game opens a small, well-styled panel where the player chooses a free color from clearly illustrated color choices, instead of showing the selector in every game-list row.

## Why

The human reviewed merged PR #156 and described its inline selector as “en veldig stygg løsning.” They prefer “en liten popup med fin panel” and want color choices “presentert og ikke bare tekst”; a combo box is acceptable.

## Scope

**In:** Move the join color control into a focused modal dialog; display every free color as a visible swatch alongside its name; keep the free-color choices and existing join API behavior. Add compact responsive styling.

**Out:** Changing the five allowed colors, create-game selection, API and engine rules. Those were already implemented in merged PR #156.

## Reference

New design direction from the human's screenshot and message; no old-client reference for the dialog. The existing `ReferenceDialog` establishes modal focus behavior and overlay style.

## Approach

Replace the per-row select with the existing Join button. On click, open `ReferenceDialog` for that game with a compact grid of accessible radio choices, each pairing a color swatch with its name. Submitting calls the existing callback with the chosen available color; closing the dialog makes no request. Reuse the five-color `availableColors` in the public summary.

## Claimed paths

- `packages/web/src/views/GameList.tsx`
- `packages/web/src/views/GameList.test.tsx`
- `packages/web/src/views/ReferenceDialog.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [x] The game-list table has no inline color select.
- [x] Join opens a small modal panel with title, guidance and visual color choices.
- [x] The panel contains only colors available for the latest game summary; a color taken while the dialog is open disappears from the choices.
- [x] Confirm submits the selected color; Cancel, close and Escape submit nothing.
- [x] Modal remains usable on narrow screens and returns focus to the Join button when closed.
- [x] Typecheck, tests, build and browser check pass.

## Open questions

None. The user supplied the five allowed colors and approved a compact color picker.
