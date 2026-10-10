# Assisted play: phase summary and a board-first layout

- **Slug:** `assisted-phase-layout`
- **Branch:** `feat/assisted-phase-layout`, branched from `feat/assisted-gp-tokens`
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in progress
- **Issue:** [#260](https://github.com/cash1981/playciv/issues/260), the first slice of [#261](https://github.com/cash1981/playciv/issues/261)

The human tests `feat/assisted-play-contract` meanwhile. This branch, like the
Great Person one before it, is merged into that branch only when the human says so.

## Goal

The game page explains where the game stands and gives the board the space it
needs. At the top: the round, the viewer's own phase, who is waited for, a short
resource line and any card choice that is waiting. Below the header: shortcuts
to Board, Your cards, Tech tree and Chat and history. On every screen size the
order is the board, then Your cards directly under it, then the other controls.

## Why

From #260 (the agreed design, the screenshots in the issue could not be
fetched, so the text is the spec):

- "Show round, current phase, who may act, completion/waiting state, remaining
  city actions, resources and pending choices."
- "Desktop: the game board uses the full available content width. Place Your cards
  directly below the board, followed by the complete tech tree, chat, player
  information and history. The culture track remains visible above the board."
- "Mobile: keep the board first and Your cards immediately below it in one vertical
  column; scrolling is acceptable. Provide shortcuts to Board, Your cards, Tech
  tree and Chat. Preserve drafts, focus and pending selections during updates."
- #261 acceptance: "Confirm that no cards or side panel reduce the board width at
  desktop sizes, and that Your cards follows the board in both layouts."

## Scope

**In:**

- A phase summary in the existing header panel of `GameView`, derived only from
  data the projection already carries (`view.activeTurn`, `turnStatus`-based
  fields, `you.playerTurns[].done`, `you.stats`, `you.pendingRewards`,
  `availableActions`). No new engine or server state: the phase is the first phase
  not marked done (the existing rule), and nothing is inferred from chat text.
  It says, for a player: "Round N", "You: <phase> (k of 5)" or "You: all phases
  done", "Waiting for <names> (<phase>)" using the existing waiting list, a
  resource line (culture, trade, coins total) and "1 card choice waiting" (a link
  to it) when `pendingRewards` is non-empty. A spectator sees the round and who
  is waited for, nothing about resources.
- Shortcut buttons (Board, Your cards, Tech tree, Chat, History) that scroll the
  panel into view and move focus to it, with smooth scrolling off when the user
  prefers reduced motion. They are real buttons, keyboard reachable, readable at
  320 px.
- Order of the page: header and summary, the "Your actions" panel, the board, Your
  cards, then Draw, the tech tree, the chat and orders timeline, the opponents'
  hands, battle, social policies, status, wonders, then the log and the revealed
  feed. The culture track stays at the top of the board.
- The board's piece palette no longer sits beside the board on wide screens: the
  board takes the full content width at every size and the palette goes below it
  (the layout it already has on a phone). This is the human-unconfirmed choice of
  this branch: the issue says no side panel may narrow the board; the mockups
  could not be read. Dragging and tap-then-tap placement are unchanged.
- Tests for the summary (player in each phase, all done, waiting names, spectator,
  pending choice, resources), the shortcuts, and the new order of the page (the
  existing composition test that pins the old order is changed on purpose, and
  `decisions.md` says so).

**Out, and why:**

- "Remaining city actions" and per-city state: cities are not modelled; it comes
  with the build work (#264).
- Persisted phase progress beyond the existing done marks: they already exist.
- Collapsing or forcing open panels, the Finish phase button, any rule or state.
- Full-width board on a phone is already the case.

## Claimed paths

- `packages/web/src/views/GameView.tsx`, `FaqView.tsx` (one sentence), `PhaseSummary.tsx` (new), `PhaseSummary.css`
  (new) and tests, `packages/web/src/styles.css`, `BoardView.tsx` and its CSS only
  for the palette position
- `docs/agents/decisions.md`, `state.md`

## Acceptance criteria

- [ ] The header shows round, the viewer's phase, who is waited for, resources and
      a waiting card choice; a spectator sees only the round and who is waited for.
- [ ] Shortcuts scroll to and focus Board, Your cards, Tech tree, Chat and History.
- [ ] At 1280 px the board is as wide as the content column (nothing beside it),
      Your cards is directly below it, and the same holds at 390 px and 320 px with
      no horizontal page scroll.
- [ ] Palette drag and tap-then-tap placement still work (browser check).
- [ ] No private data enters another viewer's projection (nothing server side
      changed).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (suites one at
      a time).
- [ ] Verified in the browser at 1280, 390 and 320 px.

## Open questions

- The palette below the board instead of beside it (see Scope). Reversible in CSS.
