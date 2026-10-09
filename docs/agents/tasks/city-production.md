# City production: a per-city estimate with a manual override

- **Slug:** `city-production`
- **Branch:** `feat/city-production`, branched from `feat/assisted-play-contract` (PR #271)
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** draft
- **Issue:** [#250](https://github.com/cash1981/playciv/issues/250) slice A and a first part of slice B, a foundation for [#264](https://github.com/cash1981/playciv/issues/264)

This branch is merged into `feat/assisted-play-contract`, and pushed there, only when the human says it is ready.

## Goal

Each city shows how much production it has, with the arithmetic visible, so the
player (and later the Build button) knows what the city can afford. The number is
always labelled an estimate, because the map data does not hold every icon, and
the player can type in the real number for any city. A typed number always wins.

## Why

#264 says "Do not present a modifier subtotal as complete production" and "Reuse
#250's production/output work". The human, on the missing calculator: "Gjør det du
vet og spør det du er usikker på ... dersom dette blir for komplisert så kan vi ha
en overstyr tekstboks ... Så kan vi gjøre en best guess". And: "all functionality
må kunne overstyres".

## Rules the human confirmed

- Production is the number of production icons in the city's outskirts, spent on
  one item per city action. Excess is lost (base rules p. 15).
- Forest gives 2 production, mountain 1, grassland, desert and water 0. (The human
  confirmed mountain 1; forest 2 is in the base rules p. 26 example.)
- A building on a square replaces every icon the square had (base rules p. 16). The
  table of what each building gives is in `building-data.ts` below.
- An enemy figure in a square means it gives the owner nothing (blockade, base
  rules p. 27). Reuse the existing blockade code.
- Infrastructure: up to 3 investments (`stats.infra`), each gives +1 production in
  every city. Count at most 3.
- Despotism (the government in play) gives each city +1.
- Chichen Itza (owned wonder, not blockaded): +3 in each city. Susan B. Anthony
  (revealed in hand, her Humanitarian type not fully blockaded): +2 in each city.
- Military Science (revealed): each city +1 for every 3 coins the player has.
- Building program (Wisdom and Warfare p. 7): a marker on the city centre. When the
  city produces, outskirts production is doubled, nothing else is. Show it as a
  second figure, "with building program", when the marker is on the city centre.
- Cities' outskirts may not overlap when built (base rules p. 13), so a square
  belongs to one city. If old data overlaps, count it for each city and say so.
- A metropolis has two centres and ten outskirts squares (the existing footprint).

## Scope

**In:**

- Engine, new `city-production.ts`: `cityProductionsOf(state, player)` returns one
  `CityProduction` per city piece of the player: the piece id, a label (kind plus
  `squareOf`), `outskirts` (the sum), `outskirtsDetail` (one entry per square that
  gives something or is unknown: the square, the source, the amount, blockaded
  flag), `modifiers` (label, amount, applied flag and a note for the ones switched
  off), `buildingProgram`, `estimate` (outskirts plus modifiers), `withBuildingProgram`
  (only when the marker is there), `override` (the typed number or null), `effective`
  (the override if set, else the estimate), `notes` (the honest caveats).
- A `building-data.ts` table, shared later by the Build button: per building asset
  the production, trade, culture and coin icons, the production cost, and the combat
  bonus, taken exactly from the human's table below.
- Not counted but named in `notes` when they apply: Communism as government,
  Urban Development revealed, squares with a wonder, great person or unknown terrain
  (their icons are not in the data), scouts sending a square to another city.
- Export from `blockade.ts` what is needed to get a city's centres, outskirts cells
  and the per-cell enemy-figure check (one new exported function, not a copy of the
  logic); `terrainAt` needs a point, convert a cell to its centre point.
- The manual override: an optional `productionOverride` on the city `BoardPiece`,
  set through a new `BoardChange` kind (apply and reverse, like `wonderCoins`), an
  action in `actions/board.ts`, a route next to `/owner` in `routes/board.ts`, an api
  method, and migration safety (an absent field stays absent). Any player in the game
  may set it, like other board edits. Setting it to nothing removes it. Undo of the
  board change restores the old value. A non-negative whole number, a sensible cap.
- Projection: `cities: readonly CityProduction[]` on every player's public view and
  on the own view (everything is derived from the public board and revealed items;
  use `!hidden` for techs, great person items and social policies). Add the hidden
  information tests.
- Web: a collapsed "Cities" panel after Status. For the viewer's cities: the label,
  "Estimated production 11, not a complete count" with a details element showing the
  squares and modifiers, the building program figure when present, the notes, and a
  "Set by hand" number field with a "Use the estimate" button. Opponents' cities
  appear read-only below. Spectators see all read-only. Works on a phone.
- Tests at engine, server and web level, the FAQ sentence, `decisions.md`.

**Out, and why:**

- The Build button, city action and legal choices: the next parts (#264).
- Trade converted to production (3 trade for 1): chosen at build time, in the Build part.
- Trade, culture and coin icon totals per city: the table holds them, but only
  production is needed now; they are #250 slice B.
- Scout-to-city assignment, Great Lighthouse, Communism, Urban Development,
  one-turn event cards (We Love the Despot Day): named in the notes, not computed.
- Terrain data errors in `tile-terrain.json`: out of scope; the override covers them.

## Reference

Building table (the human's, in this order: production, trade, culture, coin, cost;
two values mean basic form / upgraded form). The asset ids are in `board.ts` and
`board-assets.json`.

| Building (assets) | Prod | Trade | Culture | Coin | Cost | Combat bonus |
| --- | --- | --- | --- | --- | --- | --- |
| Harbor (`harbor`) | 1 | 2 | | | 7 | |
| Trading Post (`tradingpost`) | | 2 | 1 | | 7 | |
| Workshop / Iron Mine (`workshop`, `ironmine`) | 3 / 4 | | | | 7 / 10 | |
| Library / University (`library`, `university`) | | 1 / 2 | 1 / 2 | | 5 / 8 | |
| Granary / Aqueduct (`granary`, `aqueduct`) | 1 / 2 | 1 / 2 | | | 5 / 8 | |
| Market (`market`) | 1 | 1 | 1 | | 7 | |
| Temple / Cathedral (`temple`, `cathedral`) | | | 2 / 3 | | 7 / 10 | |
| Barracks / Academy (`barracks`, `academy`) | | 2 / 2 | | | 7 / 10 | +2 / +4 |
| Shipyard / Military Dock (`shipyard`, `militarydock`) | 2 / 2 | | | | 5 / 10 | +2 / +4 |
| Bank (`bank`) | 1 | 1 | 1 | 1 | 10 | |

The Barracks / Academy trade value is as the human typed it; the human is asked to
confirm it, and the table is the one place to change it.

Figures cost 4 production for an army and 6 for a scout (the human). Units cost
5, 7, 9, 11 by rank and 12 for aircraft (base rules p. 16). Those belong to the
Build part and are not used here.

Existing code to reuse: `blockade.ts` (`pieceColorOf`, footprint, blockade check,
`isOwnWonderBlockaded`, `blockadedGreatPersonTypes`), `terrain.ts` (`terrainAt`),
`coins.ts` (`coinSourcesOf`, `totalCoins`), `culture-hand.ts` and `combat-bonus.ts`
(patterns for derived values from revealed cards), `board.ts` (`wonderCoins`
change as the model for a per-piece value with undo), `WondersPanel.tsx` (the closest
panel pattern). `derivedStats` and `opaque()` / `toPlayerView` in `state.ts` are where a
derived public value goes.

## Claimed paths

- `packages/engine/src/city-production.ts` (new), `building-data.ts` (new), `blockade.ts`,
  `board.ts`, `state.ts`, `index.ts`, `migrate.ts`, `errors.ts`, `actions/board.ts`
- `packages/engine/test/city-production*.test.ts` (new), `hidden-info.test.ts`
- `packages/server/src/routes/board.ts`, `packages/server/test/city-production*.test.ts`
- `packages/web/src/lib/api.ts`, `packages/web/src/views/CitiesPanel.tsx` (new), its css
  and tests, `GameView.tsx`, `FaqView.tsx`
- `docs/agents/decisions.md`, `state.md`

## Acceptance criteria

- [ ] A city with forests, mountains and buildings gives the right outskirts sum;
      a building replaces the terrain icons under it; water and grassland give 0.
- [ ] A square with an enemy figure gives 0 and is marked blockaded.
- [ ] A metropolis counts both orientations' ten squares and no centre square.
- [ ] Infrastructure counts at most 3; Despotism, Chichen Itza (owned, not blockaded),
      Susan B. Anthony (revealed, not blockaded) and Military Science (revealed, floor
      of coins over 3) each add per city and only when active; hidden cards add nothing.
- [ ] A building program marker on the city centre shows the doubled outskirts figure
      and does not double modifiers.
- [ ] The estimate is never called complete; the notes name what is not counted.
- [ ] The override wins, can be removed, survives reload, is undone by board Undo and
      follows time travel; an old game without it loads unchanged.
- [ ] Hidden information: another player's view carries the same cities as a spectator;
      nothing about unrevealed techs, hidden great person cards or hidden social
      policies changes any number (tests).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, suites run one at a time.
- [ ] Verified in the browser: the panel with a capital and a metropolis, an override
      set and cleared, at 1280, 390 and 320 px.

## Open questions

- The Barracks / Academy trade value (see the table). Not blocking: production is the
  only number used here.

## Handover

(to be filled in when done)
