# Responsive board zoom and panel defaults

- **Slug:** `responsive-map-panels`
- **Branch:** `codex/responsive-map-panels`
- **Owner:** Codex
- **Status:** in progress

## Goal

The map starts at the largest zoom that fits its available width, up to 100%, and follows width changes. On a browser with no saved panel choices, Log, Draw, Your hand, and Turn orders open; other sections start collapsed. A player's later choices survive reloads.

## Why

The fixed 40% map wastes space on large screens. Too many game sections begin open. The user requested that open and closed choices be remembered until changed again.

## Scope

**In:** Board width based automatic zoom, existing manual zoom selector, game and shared section defaults, persistence verification.

**Out:** Game rules, data projections, and per-account/server preferences. Browser local storage is the existing persistence mechanism.

## Reference

This is client layout behavior. The current `BoardView` uses 40%; `CollapsiblePanel` already persists state by panel ID in local storage (issue #71). No Java game rule applies.

## Approach

Measure the available board scroll width and choose the largest supported zoom step that fits the board frame. Follow container resizes while automatic zoom is selected. Keep manual selection available. Make collapsed the shared default and explicitly open the four named sections. Retain stored values ahead of defaults.

## Claimed paths

- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/BoardView.test.tsx`
- `packages/web/src/views/CollapsiblePanel.tsx`
- `packages/web/src/views/CollapsiblePanel.test.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/LogPanel.tsx`
- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/SocialPolicyPanel.tsx`
- `docs/agents/tasks/responsive-map-panels.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] The board chooses the largest available zoom through 100% that fits its container width, and responds to width changes.
- [ ] The user can still choose a manual zoom, including a zoom that scrolls.
- [ ] Fresh panel state opens only Log, Draw, Your hand, and Turn orders on the game page.
- [ ] User toggles persist after reload; existing stored choices override new defaults.
- [ ] Relevant web tests cover zoom and persistence.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] No hidden information or game state changes.

## Open questions

None.
