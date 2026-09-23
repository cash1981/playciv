# Show wonders in play and who owns them

- **Slug:** `issue-145-wonders`
- **Branch:** `feat/issue-145-wonders`
- **Owner:** orchestrator (Codex)
- **Status:** review-approved; ready for PR

## Goal

Players can see every wonder currently placed in the shared Wonders area and
which player owns it. The coin tracker also reflects The Internet's printed
effect for its owner by raising the four technology source limits from 4 to 6.

## Why

Issue #145 requests a shared view of wonder ownership and specifically calls
out The Internet's effect on tech coin limits.

## Scope

**In:**

- Add a panel listing wonder pieces in play and their owning player.
- Raise Code of Laws, Pottery, Democracy and Printing Press coin caps from 4 to
  6 only for the player who owns The Internet.
- Cover ownership/listing and cap behavior with tests.

**Out:**

- Automatically grant coins or apply any other wonder effect; the source
  counters remain manual bookkeeping.
- Change wonder placement, game state or the player projection.

## Reference

This is new in the port. Java put wonders in a player's hand and neither old
application showed ownership. In this port, wonders are board pieces in
`WONDERS_AREA_ID` (`packages/engine/src/board.ts`); issue #145 explicitly makes
the shared area the ownership source.

## Approach

Add nullable, public owner data to wonder pieces and a history-aware board
action/API route to set it. Render a compact panel that lists wonder pieces in
the shared Wonders area with an owner selector. Derive the coin cap from the
selected owner of The Internet and pass that effective limit through the
existing coin counter UI. Wonders without an assigned owner remain visible as
unowned.

## Claimed paths

- `packages/engine/src/board.ts`, `packages/engine/src/actions/board.ts`, `packages/engine/src/errors.ts`
- `packages/engine/test/board.test.ts`
- `packages/server/src/routes/board.ts`, `packages/server/test/board-api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/GameView.tsx` (panel composition only)
- `packages/web/src/views/WondersPanel.tsx` (new)
- `packages/web/src/views/WondersPanel.test.tsx` (new)
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/StatusPanel.test.tsx`
- `docs/agents/tasks/issue-145-wonders.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Wonders in play are listed with a persistent owner selector and owner's username.
- [ ] No wonders in play has a clear empty state.
- [ ] The Internet owner's four tech coin sources can reach 6; other players'
  sources remain capped at 4; other source caps are unchanged.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Browser verified on the game page. Attempted against a local server; the
  Codex browser bridge timed out before opening the app, so this remains a
  manual follow-up.
- [ ] Wonder ownership is public board data and is covered in replay/undo.

## Open questions

None. The issue identifies the shared Wonders area and the owner-dependent
effect explicitly.
