# Trade reset and collection timing

- **Slug:** `trade-collection-timing`
- **Branch:** `fix/trade-collection-timing`
- **Owner:** opencode
- **Status:** in review

## Goal

Move trade from a live estimate to the rules' actual moments:

1. When the last player ends Research and the next turn's Start of Turn starts,
   each player who chose a tech during that Research phase has their trade go
   down to their coins, capped by the trade track. This is the "trade kept as
   coins" reset. A player who only ended Research without choosing a tech keeps
   the trade they had. Revealing the tech is not required.
2. Trade can then grow during Start of Turn (abilities, cards, manual edits).
3. When a player's Start of Turn is marked done and the Trade phase opens, the
   trade around their cities is added to their trade **once**. Reopening the
   Trade tab must not count it again.
4. Undoing Start of Turn reverses that one automatic addition and clears the
   record, so re-ending it counts once against the board at that time.

## Requirements

- The reset happens from marked phase completion plus a tech chosen in the
  Research phase, not from revealing a tech. A free tech learned in Start of
  Turn is not research; removing a chosen tech clears the marker.
- The Trade tab shows the stored trade after collection. It only shows a guess
  (current trade plus city trade) when collection has not happened, for example
  in an old save already in the Trade phase.
- The guess no longer adds coins and Start of Turn gains separately: those are
  already in `stats.trade` after the reset and the Start of Turn actions.
- City trade stays the existing `CityProduction.trade` count, including scout
  squares and the same notes.
- The automatically collected amount is recorded on the player's turn so an
  undo can subtract exactly what was added, even if the board changed later.
- The collection remains per player and per turn; the Japanese ceiling still
  applies.
- No hidden information is added to any projection.

## Assumptions recorded for the human

- Reset applies per active player when the global next turn starts, which is how
  the chat-orders model represents Start of Turn starting; only players who
  researched in the ending turn reset.
- The automatic collection is capped by the trade track and records the actual
  amount added.
- A player who skips Start of Turn and marks Trade done in the same call still
  collects once, because Trade was entered before it ended.
- Research is a tech chosen in the Research phase. A free tech learned in Start of
  Turn is not research, and a turn marked ahead is recorded for that turn.
- A trade number set by hand before the collection is the player's override; the
  cities are not added to it, which also prevents an early guess from being
  counted twice. A manual set after the collection clears the record so an undo
  of Start of Turn does not subtract from the typed number.
- A legacy turn whose Start of Turn was already done before this change
  collects when Trade is first marked done, as a catch-up. A turn marked ahead
  before it starts collects at the turn start.

## Files

- `packages/engine/src/turn.ts`
- `packages/engine/src/actions/new-turn.ts`, `actions/turn.ts`, `actions/player.ts`
- `packages/engine/src/trade-collection.ts`, `trade-estimate.ts`
- `packages/engine/test/trade-timing.test.ts` (new)
- `packages/engine/test/city-production.test.ts`
- `packages/web/src/views/TradeOffers.tsx`, `TradeOffers.test.tsx`
- `packages/web/src/views/PhaseTabs.test.tsx`
- `docs/agents/decisions.md`, `docs/agents/task-board.md`, this brief

## Verification

```bash
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

Browser check: trade tab after ending Start of Turn, and reopening it without a
second addition, if a browser is available.

## Handover

Ready for the human to test on `fix/trade-collection-timing`.

- Review: approved in round 4 after the human's correction. The reset now needs
  a tech chosen in the Research phase (`Playerhand.researchTurns`); a player who
  only ended Research keeps their trade, including collected city trade.
- Validation: `pnpm -r typecheck && pnpm -r test && pnpm -r build` passed
  (engine 2077, server 847, web 1134 tests).
- Browser interaction was not checked because the browser extension was not
  connected; test the Trade tab after ending Start of Turn and reopening it.
- Committed on the branch; not merged.
