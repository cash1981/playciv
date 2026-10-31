# Great Persons: A. P. Giannini and Frida Kahlo

- **Slug:** `great-person-trade` · **Branch:** `feat/great-person-trade` (stacked on `feat/great-person-arts`, PR #328) · **Owner:** Claude Code (Sonnet 5.5) · **Status:** in progress

## Goal

Issue #301, next batch. The human: "ok kjør på med 1" (Giannini + Frida).

- **A. P. Giannini** (Start of Turn, stays faceup): "Each time you invest a coin, build an unlocked building in one of your cities for free."
- **Frida Kahlo** (Any Time, discard): "discard any culture events you don't want and then draw enough culture events to fill your hand. Draw from the culture deck for the area on the culture track that your culture marker is in."

## Scope

**In:** Giannini as a free building after an invest: the credit is derived from the turn's invest records made while he was faceup, minus free buildings already taken; a Start of Turn panel picks the building and square; undo removes the building. Frida as a card play with the culture cards the player chooses to discard, then a draw up to the culture hand size from the deck of the marker's area; undo puts everything back.

**Out:** replacing a building on the square (a free build uses empty squares only, like Cousteau's Harbors); Frida's reshuffle choice when the deck runs out beyond the normal reshuffle; Mark Twain (separate).

## Reference

`assisted-sot.ts` (`invest`), `assisted-cards.ts` (Cousteau's free placement, `playCard`), `build-options.ts` (`freeBuildingSquaresOf`, `BUILDABLE_BUILDINGS`), `assisted-culture.ts` (`drawCandidates`, `rewardSheet`, `shuffleSheetTwice`), `culture-hand.ts`, `actions/board.ts` (`isAssistedBoardChange`). Card texts in `gamedata-faf-waw.json`.

## Approach

- Giannini: invest effect gets `giannini: true` when he was faceup; new assisted action `gianniniBuild` (Start of Turn, repeatable up to the credits) with payload `{cityPieceId, assetId, column, row}`; effect keeps the piece id and board history id; Board Undo refuses it like Harbors. Undoing an invest that a free build depends on is refused. Own-view `sot.giannini` lists credits and the unlocked buildings with their squares.
- Frida: `PlayCardPayload.discard` (item ids), `PlayableCard.cultureHand` (own view); effect `frida: {discarded, drawn, sheetName}`; undo moves the drawn cards back to the deck, the discards back to the hand.

## Claimed paths

- `packages/engine/src/` (`assisted-cards`, `assisted-sot`, `assisted-core`, `assisted`, `build-options`, `card-timing`, `state`, `actions/board`), `packages/engine/test/`
- `packages/server/src/routes/` and `packages/server/test/`
- `packages/web/src/views/{PlayableCards,SotPanel}.tsx` and their tests, `packages/web/src/lib/api.ts`
- `docs/agents/`

## Acceptance criteria

- [ ] Engine tests per card: effect, undo, repeat, wrong phase, projection
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: discarded and drawn cards stay out of other views; `sot.giannini` and `cultureHand` own view only
- [ ] Browser check: Giannini free build after an invest, Frida discard and draw

## Open questions

None blocking.
