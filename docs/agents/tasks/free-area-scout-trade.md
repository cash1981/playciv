# Free player-area moves and scout trade

- **Slug:** `free-area-scout-trade`
- **Branch:** `fix/100-292-free-area-and-scout-trade`
- **Owner:** opencode
- **Status:** ready for review

## Goal

A piece moved on the board keeps the spot where the player drops it, including
inside a player area, instead of being tidied into the next grid slot. A scout's
square counts its trade for the city the scout is sent to, including the capital
it goes to when the player does not send it.

## Why

Issue #100: "I want to be able to move pieces freely in player area... Right now
it is snapped in place." Issue #292: "Trade around cities should be 13 (three
from scouts since it defaults to capital). I think that is where the issue is.
That scout trade is not counted. But guess is 10."

## Scope

**In:**

- Stop snapping an already placed piece to the area grid when it is moved; a new
  piece dropped from the palette still tidies into the free slot.
- Count the trade of a square a scout sends to its city, using the same square
  reading as production (building, Great Person, map icon or disaster token).
- Update the current decision text and regression tests for both changes.

**Out:**

- Any change to the production or gathering rules for a scout's square.
- Moving the shared Wonders area configuration or piece supply rules.

## Reference

- `packages/engine/src/actions/board.ts` (`movePieceUnchecked`, `placeUnchecked`)
- `packages/engine/src/city-production.ts` (`CityTrade`, `scoutSquareProduction`)
- `packages/engine/src/sot.ts` (`scoutDestinationsOf`)
- [Decisions: Board and manual bookkeeping](../decisions.md#board-and-manual-bookkeeping)
- [Decisions: Trade offers (#265)](../decisions.md#trade-offers-265)
- Issues [#100](https://github.com/cash1981/playciv/issues/100) and
  [#292](https://github.com/cash1981/playciv/issues/292)

The issue owner's wording above is the requirement; the current decision that a
scout's trade is not counted is superseded.

## Approach

Remove the player-area branch from `movePieceUnchecked`. Keep the map-tile
nearest-slot snap and the `snap: false` opt-out for it. `placeUnchecked` keeps
tidying a new piece into the area grid.

In `city-production.ts`, factor the icon-bearing pieces on a square and add a
scout-square trade reader next to the production one. For each assignment that
lands outside the city's own footprint, add the square's trade to that city's
trade detail, so it reaches the trade estimate. A square inside the city's
outskirts is already counted once by the outskirts walk. Refresh the trade note
that used to say a scout's square gives no trade.

## Claimed paths

- `packages/engine/src/actions/board.ts`
- `packages/engine/src/board.ts`
- `packages/engine/src/city-production.ts`
- `packages/engine/src/assisted.ts`
- `packages/engine/test/board.test.ts`
- `packages/engine/test/city-production.test.ts`
- `packages/engine/test/assisted-city.test.ts`
- `packages/engine/test/chat-orders-turns.test.ts`
- `packages/server/test/board-api.test.ts`
- `packages/web/src/views/BoardView.tsx`
- `docs/agents/tasks/free-area-scout-trade.md`, `docs/agents/task-board.md`,
  `docs/agents/decisions.md`

## Acceptance criteria

- [x] A piece moved into a player area stays at the dropped coordinates; a newly
      placed piece still tidies into the next free slot.
- [x] A scout not sent anywhere adds its square's trade to the capital's trade,
      and the trade estimate includes it.
- [x] A scout sent to another city takes its square's trade from the owning city
      and gives it to the city it is sent to, without counting it twice.
- [x] The trade notes and current decisions describe the new behaviour.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: the estimate remains projected only to its player; the
      existing projection test still passes.
- [ ] Verified in the browser: not run. The dev server and API answered 200, but
      the browser extension was not connected, so the drag and trade popup were
      not exercised by hand.

## Open questions

None.

## Handover

Review: independent reviewer approved after the start-marker fix; only accepted nits remain.

Validation: `pnpm -r typecheck && pnpm -r test && pnpm -r build` passed
(engine 2058, server 847, web 1133 tests). Browser interaction could not be
checked because the browser extension was not connected.
