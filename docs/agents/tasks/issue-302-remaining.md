# Remaining figure movement (issue #302, final slices)

- **Slug:** `issue-302-remaining`
- **Branch:** `feat/issue-302-figure-movement` (same PR, #309, by the human's choice)
- **Owner:** Claude (Sonnet 5.5) as orchestrator
- **Status:** in review (round 2 approved with nits)
- **Issue:** [#302](https://github.com/cash1981/playciv/issues/302)

## Goal

Finish the movement work still open on #302 after Galileo, the culture cards,
Hannibal and Communism: stacking on own figures, Steam Power's Silk ability,
Brandenburg Gate's outskirts rule for every kind of move, map-tile discovery, and
the scout gathered-square follow-up.

## Human decisions (2026-10-29)

- **Battle, loot and stacking: "Stacking only".** Own-figure stacking up to the
  effective stacking limit (including Pasteur) is enforced and offered as a
  destination. An enemy figure's square stays excluded; battle and loot remain
  manual, as today. Nothing starts a battle or removes figures.
- **Discovery: "Explore from the edge".** Unexplored squares can no longer be
  walked onto. A figure on, or moving to, a square next to an unexplored slot can
  explore it: a popup asks to spend 1 movement, the next tile is drawn from the
  deck and placed in that slot (rotation 0, turnable by hand). Move then explore,
  or explore then move, within one turn; undo returns the tile and the movement.

## Scope

**In:**

1. Stacking on own figures in normal travel (a destination while the square holds
   fewer own figures than the stacking limit; own squares may be walked through,
   enemy squares may not).
2. Steam Power's City Management Silk ability: spend a Silk, move all of your
   figures in one square to any water square on the map; they cannot move again
   this turn. Source: the card art `SteamPower.jpg`, rules 193 to 199 of the
   official/unofficial summary.
3. Brandenburg Gate (rules 209 to 214, 333, 340): a figure may not end a move in
   the outskirts of every city of another player's Brandenburg Gate holder (not the city centre);
   applies to travel, Galileo, Hannibal, Steam Power and the movement culture
   cards. Communism's Spy exception is not modelled.
4. Map-tile discovery as decided above.
5. Scout gathered-square follow-up (rules 198, 257, 334, 341, 422 to 424) where
   the current gather code can express it.

**Out:** automated battle, loot and figure removal (human chose to leave manual).

## Claimed paths

- `packages/engine/src/movement.ts`, `steam-power.ts` (new), `brandenburg.ts` (new),
  `explore.ts` (new), `galileo.ts`, `card-movement.ts`, `assisted-cards.ts`,
  `assisted-core.ts`, `assisted-techs.ts`, `assisted.ts`, `card-timing.ts`,
  `city-gather.ts`, `board.ts`, `actions/board.ts`, `errors.ts`, `index.ts`, `state.ts`
- `packages/engine/test/stacking-movement.test.ts`, `steam-power.test.ts`,
  `brandenburg.test.ts`, `explore.test.ts` (new), and the existing movement tests
- `packages/server/src/routes/board.ts`, `routes/assisted-args.ts`, `errors.ts` and tests
- `packages/web/src/lib/api.ts`, `views/BoardView.tsx`, `GameView.tsx`,
  `PlayableCards.tsx`, `AssistedActions.tsx`, `TechPanel.tsx` and tests
- `docs/agents/decisions.md`, `state.md`, `task-board.md`, this brief

## Acceptance criteria

- [x] A figure may end on a square holding fewer own figures than the stacking
  limit and may not exceed it; enemy squares are still excluded.
- [x] Steam Power's Silk moves every own figure in a chosen square to a water
  square, locks them, spends a Silk, and the card/action undo restores all.
- [x] No move ends in another player's Brandenburg Gate outskirts, with the
  clear exception of the owner's own figures.
- [x] A figure can explore an adjacent unexplored slot for 1 movement; the drawn
  tile lands in that slot; two board Undos return the tile and the movement. The
  tile card stays in the hand (accepted compromise, see decisions.md).
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass; independent
  review approved; hidden information unchanged.

## Handover

Verified 2026-10-29: `pnpm -r typecheck`, `pnpm -r test` (engine 2202, web 1156, server 852)
and `pnpm -r build` pass. Browser run on a seeded two-player game: yellow squares with own-figure
stacking, blue Explore squares, tile placed, remaining range reduced, two Undos restore. Steam
Power and Brandenburg Gate were not browser-tested. Independent review approved in round 2.
Brandenburg Gate guards every city (confirmed by the human). Open for the human: Steam Power onto enemy figures.
