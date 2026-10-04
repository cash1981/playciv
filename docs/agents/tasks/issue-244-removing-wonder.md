# Issue #244: disable a wonder without deleting its board piece

- **Slug:** `issue-244-removing-wonder`
- **Branch:** `fix/issue-244-removing-wonder`
- **Owner:** Codex
- **Status:** done

## Goal

Removing a wonder card disables its effect while preserving the physical wonder piece on the board.

## Why

Issue #244 reports that removing a wonder currently removes its token/building, and says a culture token remains active when a city devotes.

## Scope

**In:**

- Change the Wonders panel's Remove behavior to disable a wonder rather than delete its board piece.
- Ensure clearing ownership turns off current owner-based wonder bonuses.
- Add regression coverage and document any visible behavior change.

**Out:**

- Changing the actual rules for city devotion or wonder effects beyond the reported deactivation behavior.

## Reference

Today `WondersPanel.tsx` calls `api.removePiece`, which removes the `BoardPiece`; `setWonderOwner` is a separate existing action. Existing owner-dependent wonder bonuses check `ownerId`. The human clarified that the physical piece should remain and its bonuses should turn off; the culture-token behavior is out of scope for this fix.

## Approach

Use the existing reversible `setWonderOwner(..., null)` action when the user disables an owned wonder. Label the control “Disable”, and keep the wonder piece visible in the Wonders panel and on the board. An unowned wonder already has no owner-based bonuses, so it has no Disable control.

## Claimed paths

- `packages/web/src/views/WondersPanel.tsx`
- `packages/web/src/views/WondersPanel.test.tsx`
- `packages/engine/test/board.test.ts`
- `packages/engine/test/culture-hand-size.test.ts`
- `packages/engine/test/combat-bonus.test.ts`
- `packages/server/test/board-api.test.ts`
- `docs/agents/tasks/issue-244-removing-wonder.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`

## Acceptance criteria

- [x] Disabling an owned wonder clears its owner and preserves the board piece.
- [x] Current owner-based wonder bonuses stop when the owner is cleared.
- [x] Regression tests cover the UI action, persisted board piece, and disabled bonuses.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Browser-verified in the Wonders panel and relevant game view. (The local dev store has no game; UI behavior is covered by component tests.)

## Open questions

None. The human asked to leave the culture token behavior out of scope for now.
