# Assisted gather: Devote to the Arts and Harvest

- **Slug:** `assisted-gather`
- **Branch:** `feat/assisted-play-contract` (PR #271, by the human's choice)
- **Owner:** Claude (Sonnet 5.5)
- **Status:** in progress
- **Issue:** [#264](https://github.com/cash1981/playciv/issues/264) (the other city actions)

Read `tasks/assisted-city-actions.md` and the "Devote to the Arts and Harvest" decisions first.

## Goal

Two more city actions as buttons, so the player does not count icons by eye and move tokens by hand:

1. **Devote to the Arts** (base rules p. 17): the culture of the city is added to the stock.
2. **Harvest a resource** (p. 18): one token of a resource found in the outskirts, or under a scout, goes to the player area.

The human's wish: read how much culture and which resources lie around the city (and under a scout) from the map; with several resources the player chooses one; the token appears in the player area by itself; the culture is added by itself.

## Rules (source in brackets)

- Devote: one culture, plus one per culture icon in the outskirts; a metropolis starts at 2 (base p. 17, Fame and Fortune). A building replaces the icons of its square (p. 16). Enemy figures blockade a square (p. 27). A scout gathers the icons of its square for one city (p. 26).
- Harvest: the city needs the resource icon in its outskirts; one token per action from the market; none if the market is out (p. 18). A resource under a building, wonder, Great Person or disaster token cannot be harvested (the human's ruling). The same icon cannot be harvested twice in a turn (FAQ).

## Scope

**In:** `data/tile-icons.json` (read by eye from the 43 tile images, key on base rules p. 7), `tile-icons.ts`, `city-gather.ts`, the two options on `CityActionOptions`, the two assisted actions with undo, strict payload parsing, `CityGather.tsx` (two buttons and their panels), tests at engine, server and web level, FAQ and decisions.

**Out:** a "used this turn" marker and the one-icon-per-turn rule (the human decided against tracking city actions), the scout-to-city assignment, the culture of wonders and Great Persons, civilization, government and card effects on culture, Angkor Wat's second harvest, coin and trade icons.

## Claimed paths

- `packages/engine/data/tile-icons.json`, `src/tile-icons.ts`, `city-gather.ts`, `city-actions.ts`, `limits.ts`, `terrain.ts`, `assisted.ts`, `state.ts`, `index.ts`, `actions/board.ts`
- `packages/engine/test/assisted-gather.test.ts`, `assisted-city-actions.test.ts`
- `packages/server/src/routes/play.ts`, `packages/server/test/assisted-city-actions-api.test.ts`
- `packages/web/src/lib/api.ts`, `views/CityGather.tsx`, `CityGather.test.tsx`, `CityCard.tsx`, `CityCard.css`, `CityActions.tsx` and test fixtures, `FaqView.tsx`
- `docs/agents/decisions.md`, `state.md`, `task-board.md`
