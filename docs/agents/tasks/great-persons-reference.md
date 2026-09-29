# Great Persons reference

- **Slug:** `great-persons-reference`
- **Branch:** `feat/great-persons-reference`
- **Owner:** Claude (orchestrator), coder role for the implementation
- **Status:** in progress

## Goal

A player, signed in or not, can open the site menu, choose "Great persons" and
read what every great person does. The list is grouped by type, one tab per
type, and each card shows the person's name and printed description.

## Why

Issue #202, "Menu should contain a list of all great persons": "There should
be a greatperson page or popup where you can read about what it great person
does. Very similar to the asset file and the great person tab". Answers from
the human: modal opened from the menu, tabs per type, visible to everyone
including logged-out visitors, name and description only, no search.

## Scope

**In:**

- An engine function `greatPersonReference(data)` returning every great person
  in print order as `{ name, type, description }`, in the style of
  `wonderReference`, plus a bundled constant built from the shipped
  `gamedata-faf-waw.json` that the web can import.
- A `GreatPersonsDialog` component in `packages/web/src/views/`, built on
  `ReferenceDialog`, `Tabs` and `ReferenceCard`, one tab per type (six types:
  Artist or Thinker, Builder or Inventor, General, Humanitarian, Merchant or
  Explorer, Scientist), in the order the types first appear in the sheet.
- A "Great persons" button in `Navigation.tsx` that opens it. `Navigation` is
  rendered on every screen, signed in or not, so this is public by construction.

**Out:**

- No new server endpoint: the list is static and identical for every game.
- No search, no card images: not asked for.
- No change to hidden information. The reference is the whole printed
  catalogue, never a player's hand.

## Reference

No old-system counterpart for a menu reference (old-civ-web had none; the
great person data itself is `ItemReader` column A name, B token kind, C
description, ported in `readDeck`). Do not change `readDeck`. The sheet
`Great Person` has 42 rows plus a header row, 7 per type.

## Approach

Engine: read the `Great Person` sheet rows directly (row 0 is the header; row
`[name, type, description, '']`), trim, keep print order. Do NOT reuse
`readDeck`'s column-compaction, which shuffles. Export from
`packages/engine/src/index.ts`. Web: group by type preserving first-seen order,
active tab in `useState`, dialog closes with Escape and returns focus to the
menu button (see `ReferenceDialog`'s `returnFocusTo`). Menu should close after
the button is used, like other menu items, without unmounting the dialog:
keep the dialog state so it survives the menu closing (render the dialog
outside the `<details>` dropdown).

## Claimed paths

- `packages/engine/src/gamedata.ts` (or a new `great-person-reference.ts`)
- `packages/engine/src/index.ts`
- `packages/engine/test/`
- `packages/web/src/views/GreatPersonsDialog.tsx` and its test
- `packages/web/src/views/Navigation.tsx` and `Navigation.test.tsx`
- `packages/web/src/styles.css` (only if needed)
- `README.md` (one line, if the menu is described there)

## Acceptance criteria

- [ ] `greatPersonReference` returns 42 entries, 7 for each of 6 types, in sheet order; a test pins counts and one known entry (Marie Curie is Scientist).
- [ ] The menu shows "Great persons" for a signed-out visitor and for a signed-in player; it opens a dialog with six tabs; selecting a tab shows only that type's cards, each with name and description.
- [ ] Escape closes it; focus returns to the opener.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: nothing per-game is read; the test asserts the dialog takes no game state.
- [ ] Verified in the browser: signed out, open the menu, open the dialog, switch tabs.

## Open questions

None. The human answered them.
