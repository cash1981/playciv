# Great Person automation: first low-hanging batch

- **Slug:** `great-person-automation`
- **Branch:** `feat/great-person-automation`
- **Owner:** opencode (orchestrator/coder)
- **Status:** in review
- **Issue:** [#301](https://github.com/cash1981/playciv/issues/301)

## Goal

Automate the Great Person abilities that fit the current engine without new
map-picking flows: Archimedes, William Shakespeare, Louis Pasteur, Michelangelo,
Thomas Edison, Mother Teresa and Marie Curie. Automated passive cards get a Use
button that reveals them; timed or discard cards use Play through the existing
card flow. Movement effects (Captain James Cook, Henry Ford) wait until movement
is enforced.

## Why

The human asked for the low-hanging abilities first and allowed a button on all
Great Persons, with one-shot and lasting effects distinguished. Issue #301 tracks
which Great Persons are automated.

## Scope

**In:**

- **Archimedes:** after every player has finished Research, each tech the holder
  researched that turn adds 3 culture unless another player has it revealed.
  Hidden research is ignored so the public culture total cannot leak it. Removing
  the tech takes the culture back.
- **William Shakespeare:** pressing Advance culture asks whether to skip every
  consecutive space occupied by another player's marker, paying and drawing for the
  landing space. A no is the normal advance. Requires revealed, unblockaded Shakespeare.
- **Louis Pasteur:** a revealed, unblockaded Pasteur raises the effective stacking
  limit by 1. The manual status value is unchanged.
- **Michelangelo:** playing the card discards it and arms a one-shot 5-production
  discount on the next wonder build; assisted Build shows the reduced cost and
  consumes the discount. Undo restores it.
- **Thomas Edison:** playing the card discards it and grants a free tech restricted
  to techs another player has revealed.
- **Mother Teresa:** using the card (it stays faceup) moves one chosen coin token to
  the named player and performs one free culture advance, all with vote undo.
- **Marie Curie:** playing the card arms a one-shot substitution for the next
  resource ability that spends Uranium, letting the player choose another resource
  they hold. With no Uranium-spending ability in the current sheets, the card can
  still be armed and the next eligible action consumes it.

- **Manual Great Person Draw:** the Draw button now follows the same marker-supply
  rule as the culture gain: an exhausted-type card is named, discarded faceup and
  skipped, with one reshuffle; no marker of any type means no draw.

**Out:**

- Movement effects (Captain James Cook, Henry Ford): movement is manual text and
  not enforced, so these wait.
- Abilities that need map-picking or a new battle/kill flow (Hannibal, Galileo,
  Zhukov, Gustavus, Nightingale, etc.).
- Changing the manual `stacking`/`mvmt` status fields into derived values.

## Reference

- `docs/agents/decisions.md` "Assisted play" and "Phase tabs and Start of Turn".
- `packages/engine/src/assisted-cards.ts` (card play automation),
  `assisted-abilities.ts` (Start of Turn abilities), `assisted-culture.ts`
  (culture advance), `build-options.ts` (wonder cost display),
  `actions/player.ts` (`chooseTech`, `removeTech`, `revealTech`).
- Data: `GREAT_PERSON_REFERENCE` from `engine/data/gamedata-faf-waw.json`.

## Approach

- A small pure `great-person-effects.ts` helper answers whether a named Great
  Person is active (revealed and its type not fully blockaded).
- Archimedes pays out in `startMissingTurns` after the last Research phase;
  `removeTech`/undo refund the culture recorded per tech.
- Automated passive cards (Valmiki, Adam Smith, Susan B. Anthony, Pasteur) are
  listed as Use cards; the effect is derived while the card is faceup.
- Shakespeare is a new `cultureAdvanceSkip` assisted action sharing
  `planAdvance`/`performAdvance`.
- Pasteur is used by `build-options.ts` only; the status field stays bookkeeping.
- Michelangelo, Edison, Mother Teresa and Curie use the existing `playCard` flow and
  small one-shot fields on the player/turn, with explicit undo.
- All new persisted fields are optional in migration and ignored by opponent
  projections.

## Claimed paths

- `packages/engine/src/great-person-effects.ts` (new), `actions/player.ts`,
  `build-options.ts`, `assisted-cards.ts`, `assisted-culture.ts`,
  `assisted-abilities.ts`, `card-timing.ts`, `state.ts`, `migrate.ts`, `index.ts`
- `packages/engine/test/great-person-automation.test.ts`,
  `great-person-*.test.ts`, `assisted-*.test.ts`, `build-options*.test.ts`,
  `player-action.test.ts`, `culture-advance*.test.ts`
- `packages/server/src/routes/play.ts`, `packages/server/src/routes/assisted-args.ts`
- `packages/web/src/views/PlayableCards.tsx`, `AssistedActions.tsx`,
  `PhaseTabs.tsx`, `SotPanel.tsx`, `BuildPicker.tsx`, `TechPanel.tsx`,
  `GameView.tsx` and their tests
- `packages/web/src/lib/api.ts`
- `docs/agents/tasks/great-person-automation.md`, `decisions.md`, `state.md`,
  `task-board.md`

## Acceptance criteria

- [x] Archimedes pays after Research for each qualifying tech, ignores hidden research and refunds on removal.
- [x] Shakespeare asks during Advance culture, can skip any run of spaces occupied
  by other players, pays and draws only for the landing space, and undo returns
  the marker/cards.
- [x] Pasteur adds 1 to Build's stacking limit only while revealed and unblockaded.
- [x] Michelangelo shows and consumes a 5-production wonder discount; undo restores it.
- [x] Edison grants a free tech only for techs the named player revealed.
- [x] Mother Teresa moves one chosen coin, advances one space free and undoes both.
- [x] Marie Curie arms a Uranium substitution and consumes it on the next eligible
  resource ability; no current sheet action triggers it (test with a fixture).
- [x] Automated passive Great Persons get Use (reveal); one-shot cards use Play and
  log the automated effect.
- [x] Hidden information: opponents never see hand fields, pending effects or
  candidate tech names that were not public; projection tests cover each.
- [x] Package typechecks and builds pass; engine and web tests pass. Server tests
  passed alone; the parallel root run hit two existing revision-compaction 5 s
  timeouts under load.
- [x] Verified in the browser: Pasteur Use/passive note, Shakespeare's Advance-culture prompt (no separate skip button), Michelangelo Play + Build discount note, Edison Play + public log (seeded local game, 1400 px headless Chrome).

## Open questions

Movement effects are deliberately deferred by the human's answer on 2026-10-27.

## Handover

Implemented the engine, server payload and web card form changes. Engine tests:
2096 pass. Web tests: 1137 pass. Server tests: 847 pass when run alone; the root
parallel run timed out in two revision-compaction tests (known load-sensitive
tests, unrelated files). Typechecks for all packages and the builds pass.
Independent review approved round 2 with no findings above a nit (the accepted
nit is that an already-revealed passive card still offers Use and logs again).
Browser verification used a seeded local game: Pasteur's Use and passive note,
Shakespeare's Advance-culture prompt/log, Michelangelo's Build discount note, and
Edison's Play/log were observed in headless Chrome. The manual Great Person Draw
marker filter is covered by engine and HTTP tests, not a browser check.

