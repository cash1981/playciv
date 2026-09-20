# Turn-order reveal follow-up

- **Slug:** `turn-order-reveal-followup`
- **Branch:** `fix/turn-order-reveal-followup`
- **Owner:** Codex
- **Status:** review-approved

## Goal

Reveal is available only after the corresponding order has been saved. Each
successful reveal adds a public log entry such as `Turn 1 - Karandras1 revealed
movement phase`. Editing an already revealed order makes it private again until
the new saved text is revealed.

## Why

The first hotfix allowed a reveal click while the editor still contained
unsaved text; the server then revealed the previous saved value, which looked
like nothing happened. The UI must make the save-before-reveal sequence clear.

## Scope

**In:**

- Disable Reveal while the phase is unsaved or being saved.
- Log each successful phase reveal publicly with turn number and phase.
- Preserve the existing reset-to-private behaviour when a revealed phase is
  edited and saved.
- Add engine and web regression tests.

**Out:**

- Changing the one-way reveal semantics or public projection.
- New notifications or changes to the existing save endpoint.

## Reference

This follows the explicitly requested product behaviour. The old Java/client
implementation had no reveal action or equivalent public log entry.

## Claimed paths

- `packages/engine/src/actions/turn.ts`
- `packages/engine/test/turn-action.test.ts`
- `packages/web/src/views/TurnPanel.tsx`
- `packages/web/src/views/TurnPanel.test.tsx`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/tasks/turn-order-reveal-followup.md`

## Acceptance criteria

- [x] Reveal is disabled for a phase with unsaved or in-flight changes.
- [x] Reveal becomes enabled after that phase is saved.
- [x] A reveal appends `Turn <n> - <username> revealed <phase> phase` to the public log.
- [x] Editing and saving a revealed phase requires a second reveal.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.

## Open questions

None.
