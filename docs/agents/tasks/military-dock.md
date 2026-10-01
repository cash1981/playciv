# Military dock and the Military Science card

- **Slug:** `military-dock`
- **Branch:** `feat/military-dock`
- **Owner:** Claude (orchestrator)
- **Status:** in review

## Goal

The Military Science tech shows the card from the `DoC`
folder, which unlocks two buildings, and the new Military dock building can be
placed on the board.

## Why

The human: replace the level 3 Military Science tech with the one in `DoC`,
add the attached picture as a building called "Military dock". Answers to
follow-up questions: convert the card to the existing format (jpg), update the
text to what the card says (it now unlocks the Military dock as well as the
Academy), 5 pieces like the Shipyard, combat bonus +4.

## Scope

**In:**

- `MilitaryScience.jpg` and `MilitaryScience.png` in `packages/web/public/items/`
  replaced by the card from `Moderator/DoC/Tech Cards/Tech3 Military Sience.png`.
- New board asset `buildings/militarydock` ("Military dock", 82 x 83).
- Supply limit 5 shared with the Shipyard, combat bonus +4. Workshop and Ironmine now share
  a pool of 6 as well (human's follow-up).
- The Buildings tab of the palette is grouped by upgrade family (human's follow-up, with
  a picture of the supply sheet) instead of alphabetical.
- Military Science tech text: unlocks the Military dock and Academy buildings.

**Out:**

- A unit, cost or upgrade chain for the Military dock. The card shows a cost of
  10 production, but the engine does not model building costs.
- Other DoC cards. Only Military Science was asked for.
- Committing `Moderator/` (untracked, large source material).

## Reference

None in the old system: the Military dock comes from the DoC material. The
values come from the human (card text, +4, 5 pieces); nothing is invented.

## Approach

Copy the marker into `public/board/buildings/militarydock.png`, add it to
`board-assets.json` in alphabetical position, and add it to
`BUILDING_SUPPLY_LIMIT` and `BUILDING_BONUS`. The tech card is converted with
`sips` to a 752 x 490 jpg (the existing files were 1782 x 1140 and a 154 x 100
thumbnail; the new source is smaller, so it is not upscaled).

## Claimed paths

- `packages/engine/data/board-assets.json`
- `packages/engine/src/board.ts`, `packages/engine/src/combat-bonus.ts`
- `packages/engine/test/board.test.ts`, `packages/engine/test/combat-bonus.test.ts`
- `packages/web/public/board/buildings/militarydock.png`
- `packages/web/public/items/MilitaryScience.{jpg,png}`
- `packages/web/src/views/techText.ts`
- `packages/web/src/views/BoardView.tsx`, `BoardView.test.tsx`, `packages/web/src/styles.css`

## Acceptance criteria

- [ ] `buildings/militarydock` is in the manifest with a limit of 5
- [ ] A Military dock adds 4 to its owner's combat bonus and no one else's
- [ ] Military Science shows the new card and the new unlock text
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: not affected, no projection changes

## Open questions

None.
