# Remove the hidden-tech label from the tech pyramid

- **Slug:** `issue-13-hidden-tech`
- **Branch:** `fix/issue-13-hidden-tech`
- **Owner:** Luna
- **Status:** in progress

## Goal

When a player has researched a hidden technology, the tech pyramid communicates
that state with its yellow border only; the overlapping "only you" label is no
longer shown.

## Why

Issue #13 asks to remove the extra text and box because the yellow border is
clear enough and the current label is cropped inside the tech slot.

## Scope

**In:**

- Remove the hidden-tech badge markup and its unused styling.
- Keep the hidden class, yellow border, and accessible title on the slot.
- Add or update focused client coverage if the project has a suitable test.

**Out:**

- Changes to hidden-information projection or server behaviour; the issue is
  purely visual.

## Reference

The current React component is `packages/web/src/views/TechTree.tsx`. The issue
does not change game rules.

## Approach

Make the hidden slot render its name with the existing `tech-slot researched
hidden` class, remove the badge span and `.tech-slot-badge` CSS, and verify the
client still typechecks, tests, and builds.

## Claimed paths

- `packages/web/src/views/TechTree.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [ ] Hidden researched techs retain the yellow border.
- [ ] The text and box reading "only you"/"Hidden" are absent from the slot.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] No hidden-information projection is changed.

## Open questions

None.
