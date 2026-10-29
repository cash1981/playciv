# Figure movement on the map (issue #302, first slice)

- **Slug:** `issue-302-figure-movement`
- **Branch:** `feat/issue-302-figure-movement`
- **Owner:** opencode (orchestrator/coder)
- **Status:** in review
- **Issue:** [#302](https://github.com/cash1981/playciv/issues/302)

## Goal

A player can select one of their own armies or scouts on the map, see every
square it can reach this turn in translucent yellow, and send it there with one
click. A figure moves only north, west, south or east, one square at a time, up
to its travel speed. Once it has moved it is spent for the turn until the board
Undo takes the move back. The same rules are enforced by the engine, so a
client cannot move a figure farther than its speed or into water it may not
enter.

## Why

Issue #302 asks for movement to be part of the game instead of free pixel
dragging. The first slice makes normal movement enforceable, which is also the
foundation the issue's card, tech and Great Person movement effects need.

## Scope

**In:**

- Travel speed from the player's `mvmt` status expression, with the Natural
  Religion army bonus and Henry Ford's +1 while his card is faceup. Captain
  James Cook doubles the speed for the turn when played.
- Click a map figure to highlight reachable squares: cardinal steps only, within
  the speed, on map squares, not ending in water without a revealed Sailing,
  Steam Power or Flight, and England may cross water but not end in it. A hut or
  village square ends the move; a revealed Flight flies over it.
- A new engine reducer and HTTP route for one figure move. It records the
  distance and locks the figure for the turn in the same board history entry,
  so the existing board Undo restores both the square and the movement budget.
  The movement allowance is fresh on the next turn without a saved reset.
- The board UI draws the highlighted squares as buttons above the map and sends
  the pick through the new route. Dragging/nudging a player's own map figure
  does not bypass the movement rule.
- Tests for the engine rules, the server route and the board interaction.

**Out (later slices of #302, not omissions):**

- Culture cards that move figures (Migrants, Colonists, Immigrants, Disoriented,
  Lost, Out of Position) and Hannibal need a new map-picking assisted-card flow.
- Communism's square lock needs a resource-ability flow for a tech that has no
  assisted action today.
- Charles Darwin does not alter movement; his card changes Devote to the Arts.
- Battle, loot and stacking-limit outcomes when a figure moves onto an enemy or
  friendly figure are still settled by hand. This slice highlights and allows
  empty destination squares only.
- Map-tile discovery is not automated.

## Reference

- Issue #302 itself.
- `docs/agents/decisions.md` "Assisted play" and the deferred Henry Ford/Captain
  James Cook note; `docs/agents/tasks/great-person-automation.md`.
- Rules: base rulebook Movement phase, travel speed; Natural Religion (social
  policy); Sailing/Steam Power/Flight water rules; England's navy ability;
  Henry Ford and Captain James Cook card text. The data is in
  `packages/engine/data/gamedata-faf-waw.json`, and movement water techs are
  already named in `build-options.ts` (`WATER_TECHS`).
- Current board code: `packages/engine/src/board.ts`,
  `packages/engine/src/actions/board.ts`, `packages/web/src/views/BoardView.tsx`.

## Approach

- Add `packages/engine/src/movement.ts`: parse the `mvmt` expression; derive the
  speed and water allowances from the player's revealed techs, social policies,
  civilization and faceup cards; BFS the cardinal map squares up to the speed;
  and return the destinations with their distance.
- Add optional movement bookkeeping to `BoardPiece` (turn, distance used this
  turn, locked). Extend the `move` board change with the before/after
  bookkeeping so undo and redo restore it with the position.
- Add `travelFigure` in `actions/board.ts`, enforcing ownership, the lock,
  water, path and distance. It records one `move` entry and does not use the
  freeform drag path.
- Expose the route in `packages/server/src/routes/board.ts` and the client call
  in `packages/web/src/lib/api.ts`.
- `BoardView` gets the viewer's seat and current turn number from `GameView`,
  computes the destinations with the engine helper, renders the yellow overlay,
  and routes a pick to `travelFigure`.
- Henry Ford joins the passive Great Person list; Captain James Cook gets a
  once-per-turn marker through the existing play-card automation.

## Claimed paths

- `packages/engine/src/movement.ts` (new), `board.ts`, `actions/board.ts`,
  `errors.ts`, `index.ts`, `state.ts`, `assisted-cards.ts`, `card-timing.ts`
- `packages/engine/test/movement.test.ts` (new), `assisted-play-card.test.ts`
- `packages/server/src/routes/board.ts`, `errors.ts`,
  `packages/server/test/board-api.test.ts`
- `packages/web/src/lib/api.ts`, `packages/web/src/views/BoardView.tsx`,
  `BoardView.test.tsx`, `GameView.tsx`, `styles.css`
- `docs/agents/tasks/issue-302-figure-movement.md`, `decisions.md`, `state.md`,
  `task-board.md`

## Acceptance criteria

- [x] Selecting a player's own army/scout on the map highlights cardinal
  destinations up to the movement speed, with no overlay on water unless the
  player may end there.
- [x] Clicking a highlighted square moves the figure, spends the move, and the
  figure is not selectable for another move that turn; board Undo restores the
  square and the budget.
- [x] A move onto a hut or village stops there; without Flight it cannot continue
  past it, while a revealed Flight may fly over.
- [x] The engine rejects a move farther than the speed, a diagonal, an illegal
  water destination and a locked figure. Natural Religion adds 1 to an army's
  speed; Sailing, Steam Power and Flight allow ending in water; England may
  cross but not end in water; Henry Ford adds 1 while faceup; Captain James Cook
  doubles the turn's speed.
- [x] The next turn gives the figure its speed again without a stored reset.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [x] Hidden information: movement uses only the board and the viewer's own
  seat; no hand or private card data is added to public output.
- [ ] Verified in the browser: not yet, the human will test manually.

## Open questions

None blocking this slice. The map-picking card/tech flows are explicitly out.

## Handover

Implemented on `feat/issue-302-figure-movement`: the engine movement helper,
`travelFigure` and its route, the board highlight/pick UI, the movement state on
the board history, the Natural Religion/Ford/Cook speed rules, and the
hut/village stop rule (Flight flies over). The engine,
server and board tests cover the speed, water, lock, undo and interaction cases.

Validation on 2026-10-27:

- `pnpm -r typecheck` passed.
- `pnpm -r test` passed: engine 68 files / 2123 tests, web 63 files / 1143 tests,
  server 40 files / 849 tests.
- `pnpm -r build` passed.
- Independent read-only review approved after three rounds; no finding above a
  nit remained.
- Browser check was not run. The human will test manually.

Remaining #302 work is the explicit "Out" list above; the core rule is the
foundation for those map-picking card/tech flows.
