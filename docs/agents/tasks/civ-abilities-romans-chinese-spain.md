# Civ abilities: Romans, Chinese, Spanish

- **Slug:** `civ-abilities-romans-chinese-spain` · **Branch:** `feat/civ-abilities-romans-chinese-spain` · **Owner:** orchestrator (Claude Sonnet 5.5) · **Status:** in progress

## Goal

Issue #368 ("Automate Civs"), first batch. The human asked to start with Romans, Chinese and Spain. England is already automated (water crossing in `movement.ts`, armies gather as scouts in `assisted-city.ts`) and needs no work beyond a regression test if one is missing.

- **Romans:** advance one space on the culture track for free each time they build a wonder. Cities already do this (`assisted-city.ts`, `romansAdvanceStop`, `performAdvance(..., { free: true })`). Conquering a city or village stays manual.
- **Chinese:** gain 3 culture each time a Chinese figure collects a hut (`actions/token-collection.ts`, `travelFigureCollecting`). Villages: see Open questions.
- **Spanish:** travel speed +1 from the moment the civ is revealed. `movement.ts` already adds a typed `+N` bonus from `stats.mvmt` (default `'2'`); nothing sets it on reveal.

## Scope

**In:** the three effects above, each with a log line, undo behaviour and tests.

**Out:** conquest triggers (Romans, Chinese village conquest), Chinese walls and battle save, other civs. Not covered by this branch.

## Reference

- Civ cards in `Civilization/Civs/` (untracked); FAQ 2.0.
- decisions.md: civilization reveal / undo (`civSetup`), white figures, culture track.
- Source: `assisted-city.ts`, `assisted.ts` (build, `placeWonder`), `actions/token-collection.ts`, `actions/player.ts` (civ reveal), `actions/undo.ts`, `movement.ts`.
- Tests to extend: `undo-civ-reveal.test.ts`, existing Romans city test, token-collection tests.

## Approach

Follow the existing Romans city path for wonders: after a successful wonder build, if the builder is Roman and `freeAdvanceStatus` is ok, call `performAdvance` with `free: true`. If the advance is blocked (card choice pending, hand over limit) it must be refused before the wonder is placed, as for cities. Undoing the build must undo the advance.

Chinese: when a hut (not relic) is collected by a Chinese player, add 3 culture through the same helper other culture gains use, log it publicly, and make the existing token-collection undo take it back.

Spanish: set the typed bonus when the civ is revealed (`mvmt` becomes `'2+1'` unless the player already typed a different base) and restore it in the `civSetup` undo. Do not break hand-typed values.

## Claimed paths

- `packages/engine/src/assisted.ts`, `assisted-city.ts`, `actions/token-collection.ts`, `actions/player.ts`, `actions/undo.ts`
- `packages/engine/test/` (new and extended tests)
- `docs/agents/decisions.md` (one short topic)

## Acceptance criteria

- [ ] Roman wonder build advances one space; blocked and end-of-track cases behave like the city path; undo reverts both
- [ ] Chinese hut collection gives +3 culture; non-Chinese and villages/relics unchanged; undo reverts
- [ ] Spanish reveal sets +1 movement; undone reveal restores it; typed values survive
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: no new projection fields; logs stay public-form only
- [ ] Browser check: not needed unless UI changes; disclose if skipped

## Open questions

- Chinese villages: the card says "explore a hut or conquer a village", but villages here are drawn like huts. Default: huts only until the human decides.
