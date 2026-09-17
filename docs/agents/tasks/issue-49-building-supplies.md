# Issue 49 follow-up — Correct building supplies

- **Slug:** `issue-49-building-supplies`
- **Branch:** `fix/issue-49-building-supplies`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

Correct the board availability rules to match the physical building counts in
the supplied reference image.

## Rules

- Market: 5
- Temple: 5
- Barracks: 5
- Workshop: 6
- Harbor: 10
- Tradingpost: 6
- Shipyard: 5

The existing upgrade-family behavior remains unchanged: Barracks/Academy,
Granary/Aqueduct, Library/University, Market/Bank, and Temple/Cathedral share
their family pool. The listed base-building count is therefore the family pool
where an upgrade exists.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/test/board.test.ts`
- `packages/web/src/views/BoardView.test.tsx`
- `docs/agents/tasks/issue-49-building-supplies.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] Each building family/type reports the count above in the palette.
- [ ] Exhaustion enforcement uses the corrected count.
- [ ] Existing resource, Great Person, API, and UI behavior remains intact.
- [ ] Typecheck, tests, and build pass.
