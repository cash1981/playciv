# Issue #244: disable a wonder without deleting its board piece

- **Slug:** `issue-244-removing-wonder`
- **Branch:** `fix/issue-244-removing-wonder`
- **Owner:** Codex
- **Status:** in progress

## Goal

Removing a wonder card disables its effect while preserving the physical wonder piece on the board.

## Why

Issue #244 reports that removing a wonder currently removes its token/building, and says a culture token remains active when a city devotes.

## Scope

**In:**

- Change the Wonders panel's Remove behavior to disable a wonder rather than delete its board piece.
- Ensure disabled wonders do not retain the reported effect.
- Add regression coverage and document any visible behavior change.

**Out:**

- Changing the actual rules for city devotion or wonder effects beyond the reported deactivation behavior.

## Reference

Today `WondersPanel.tsx` calls `api.removePiece`, which removes the `BoardPiece`; `setWonderOwner` is a separate existing action. Existing owner-dependent wonder bonuses check `ownerId`. The current engine does not model city devotion as an action, so the issue's “culture token” reference needs clarification before choosing the state change.

## Approach

Pending clarification: establish what “disable” means in game state and how the culture token is represented, then implement the smallest engine/UI change and regression tests.

## Claimed paths

- `packages/web/src/views/WondersPanel.tsx`
- `packages/web/src/views/WondersPanel.test.tsx`
- `packages/engine/src/actions/board.ts`
- `packages/engine/src/board.ts`
- `packages/engine/test/board.test.ts`
- `packages/engine/test/culture-hand-size.test.ts`
- `packages/engine/test/combat-bonus.test.ts`
- `packages/server/src/routes/board.ts`
- `packages/server/test/board-api.test.ts`
- `packages/web/src/lib/api.ts`
- `docs/agents/tasks/issue-244-removing-wonder.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Removing a wonder disables it without deleting its board piece.
- [ ] A disabled wonder does not produce the effect described in issue #244.
- [ ] Regression tests cover removal, persistence and the effect.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Browser-verified in the Wonders panel and relevant game view.

## Open questions

- Should “disable” mean clearing the wonder's owner (which turns off current owner-based bonuses), or a separate disabled state?
- What is the “culture token on the wonder” and what should happen to it when the wonder is disabled? The current engine has no city-devotion action.
