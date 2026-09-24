# Wonder descriptions on the Wonders panel

- **Slug:** `issue-167-wonder-descriptions`
- **Branch:** `feat/issue-167-wonder-descriptions`
- **Owner:** orchestrator (Claude)
- **Status:** in progress

## Goal

Each wonder shown in the shared "Wonders in play" panel shows its printed
effect text, the same way a culture card in your hand shows its text under
the art.

## Why

Issue #167: "There should be description for each wonder explaining what it
does similar to how we have it in your hand for Civ." The human pointed at
`gamedata-faf-waw.xlsx`'s "Wonders" tab as the source for the text (ignore its
Cost/Discount/shuffle columns).

## Scope

**In:**

- Every wonder piece listed in `WondersPanel` shows its description text.
- The text comes from the existing "Wonders" sheet data
  (`packages/engine/data/gamedata-faf-waw.json`, itself built from the human's
  xlsx), which already has a populated Description column — confirmed by
  inspection, unlike the Tech sheet's empty one (see `techText.ts`).

**Out:**

- A full 27-wonder reference dialog for wonders not yet drawn. The issue asks
  for the wonders already in play to read like a hand card; a browse-ahead
  catalogue (the `ReferenceDialog`/`ReferenceCard` pattern used for Government,
  Social Policy and Tech) is a different feature and not what was asked here.
- Any change to wonder effects being engine-enforced. This is text display
  only, same caveat as every other reference text in this app.

## Reference

`packages/engine/src/gamedata.ts`'s `readWonders` already parses the
Description column into `WonderItem.description`, so `Item`s drawn into a hand
already carry the text — Java's `Wonder` never implemented `Image`, and the
old client showed wonders as plain text for the same reason (see
`decisions.md`, 2026-09-15 entry). The gap is only that a wonder becomes a
`BoardPiece` once drawn onto the shared Wonders area (issue #145), and
`BoardPiece` has no `description` field, so the text is dropped at that point.

## Approach

Add a small, pure, RNG-free reader in `gamedata.ts` that returns every
wonder's name/description/era straight from the sheet (extracted from
`readWonders`'s existing cursor logic, which `readWonders` now calls too, so
there is one parser, not two). Export a static `WONDER_DESCRIPTIONS: Readonly
Record<string, string>` (name → text, only non-empty entries) computed once
from the bundled `gamedata-faf-waw.json`, next to where that JSON is already
imported (`create-game.ts`), and re-exported from `@civ/engine` — the same
"static data computed once, no server round trip" shape as `GOVERNMENT_CARDS`.
`WondersPanel.tsx` looks up each piece's description by `piece.label` and
renders it with the same `card-text` styling `ItemCard` already uses for a
hand card's text.

## Claimed paths

- `packages/engine/src/gamedata.ts`
- `packages/engine/src/create-game.ts`
- `packages/engine/test/gamedata.test.ts`
- `packages/web/src/views/WondersPanel.tsx`
- `packages/web/src/views/WondersPanel.test.tsx`
- `docs/agents/tasks/issue-167-wonder-descriptions.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`

## Acceptance criteria

- [ ] Every one of the 27 wonders' printed text is available by name from
  `@civ/engine`, sourced only from the sheet (no invented text).
- [ ] `WondersPanel` shows each in-play wonder's description text.
- [ ] A wonder with no description text (should not happen for this sheet, but
  the code must not assume it) renders without a stray empty text block.
- [ ] Refactoring `readWonders` to reuse the new reader does not change the
  shuffled deck it produces for a given seed (existing deck-order tests still
  pass unmodified).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: none — wonder text is already public print art; no
  new leak surface (this only touches board pieces already in the shared,
  public Wonders area).
- [ ] Verified in the browser: a wonder in the Wonders panel shows its text.

## Open questions

None. The human named the exact source (`gamedata-faf-waw.xlsx`, tab
"Wonders") and the exact convention to match ("similar to how we have it in
your hand").
