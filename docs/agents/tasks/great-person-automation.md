# Great Person automation: first low-hanging batch

- **Slug:** `great-person-automation`
- **Branch:** `feat/great-person-automation`
- **Owner:** opencode (orchestrator/coder)
- **Status:** in progress
- **Issue:** [#301](https://github.com/cash1981/playciv/issues/301)

## Goal

Automate the Great Person abilities that fit the current engine without new
map-picking flows: Archimedes, William Shakespeare, Louis Pasteur, Michelangelo,
Thomas Edison, Mother Teresa and Marie Curie. Passive cards keep using Reveal as
their activation; timed or discard cards get a Play/Use button through the
existing card flow. Movement effects (Captain James Cook, Henry Ford) wait until
movement is enforced.

## Why

The human asked for the low-hanging abilities first and allowed a button on all
Great Persons, with one-shot and lasting effects distinguished. Issue #301 tracks
which Great Persons are automated.

## Scope

**In:**

- **Archimedes:** when a revealed, unblockaded Archimedes is held, choosing a tech
  during Research adds 3 culture unless another player already has that tech
  (`techsChosen`) or chose it that turn (`researchTurns`). Removing the tech takes
  the culture back.
- **William Shakespeare:** a second culture-advance action skips every consecutive
  space occupied by another player's marker, paying and drawing for the landing
  space. Requires revealed, unblockaded Shakespeare.
- **Louis Pasteur:** a revealed, unblockaded Pasteur raises the effective stacking
  limit by 1. The manual status value is unchanged.
- **Michelangelo:** playing the card discards it and arms a one-shot 5-production
  discount on the next wonder build; assisted Build shows the reduced cost and
  consumes the discount. Undo restores it.
- **Thomas Edison:** playing the card discards it and grants a free tech restricted
  to techs another player has revealed.
- **Mother Teresa:** playing the card discards it, moves one chosen coin token to
  the named player and performs one free culture advance, all with vote undo.
- **Marie Curie:** playing the card arms a one-shot substitution for the next
  resource ability that spends Uranium, letting the player choose another resource
  they hold. With no Uranium-spending ability in the current sheets, the card can
  still be armed and the next eligible action consumes it.

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
- Archimedes hooks into `chooseTech`/`removeTech`; the gained culture is recorded per
  tech so a correction takes exactly that back.
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

- [ ] Archimedes adds 3 culture only for a qualifying first research, not when
  another player knows or is researching the tech, and removing the tech takes it back.
- [ ] Shakespeare can skip any run of spaces occupied by other players, pays and
  draws only for the landing space, and undo returns the marker/cards.
- [ ] Pasteur adds 1 to Build's stacking limit only while revealed and unblockaded.
- [ ] Michelangelo shows and consumes a 5-production wonder discount; undo restores it.
- [ ] Edison grants a free tech only for techs another player revealed.
- [ ] Mother Teresa moves one chosen coin, advances one space free and undoes both.
- [ ] Marie Curie arms a Uranium substitution and consumes it on the next eligible
  resource ability; no current sheet action triggers it (test with a fixture).
- [ ] Passive Great Persons keep Reveal as activation; one-shot cards use Play and
  log the automated effect.
- [ ] Hidden information: opponents never see hand fields, pending effects or
  candidate tech names that were not public; projection tests cover each.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Verified in the browser: card buttons, Build cost, culture skip, free tech.

## Open questions

Movement effects are deliberately deferred by the human's answer on 2026-10-27.
