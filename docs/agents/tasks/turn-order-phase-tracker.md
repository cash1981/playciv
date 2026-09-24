# Turn orders: per-phase save, and a whose-turn/which-phase status

- **Slug:** `turn-order-phase-tracker`
- **Branch:** `feat/turn-order-phase-tracker`
- **Owner:** orchestrator (Claude, Sonnet 5)
- **Status:** in progress

## Goal

The human asked for three things on the Turn orders panel:

1. Each phase section (SOT, Trade, City management, Movement, Research) gets its own **Save**
   button next to its existing **Reveal** button. Clicking Reveal now saves the phase first (if it
   has unsaved edits) and reveals it in one click, instead of being disabled until a separate save.
   The existing "Save all changes" button is unchanged.
2. A single, clearly visible status — whose turn it is, and which phase they are working on —
   shown near the game title (the row that already shows the game name / "Your turn" tag), driven
   by the same information as end-of-turn logging and email.
3. When a turn is handed to the next player (`endTurn`, and `takeTurn`), the game log gets a line
   naming the new active player and the phase they should continue with, and the existing
   "It is your turn" email is reworded to say the same thing.

## Turn model (confirmed with the human)

- Exactly one player is "on turn" at a time (`Playerhand.yourTurn`), advanced by `endTurn`/
  `takeTurn` exactly as today — this task does not change when the turn passes, only what is
  displayed and logged when it does.
- Players may draft ahead concurrently (private, unsaved edits), but only one player's turn is
  active.
- Phase order is fixed and always the same: SOT → Trade → City management → Movement → Research.
  (A future Great Person, Khalid, can steal the turn out of order — explicitly out of scope, to be
  filed as a follow-up issue, not guessed at here.)
- "Which phase is a player on" is derived, not stored: the first phase of their most recent
  `PlayerTurn` that is not yet revealed; once every phase of that turn is revealed, the player is
  considered done with that round and back to SOT for the next one. This must be computed only
  from the `revealed` booleans (already public, per `publicTurn`), never from order text, so it
  cannot leak hidden information.
- Private log (`gamenote`) stays completely outside this — it already duplicates whatever the
  player wants visible while planning, per the human's existing habit, and needs no save/reveal
  buttons of its own.

## Scope

**In:**

- `packages/engine/src/turn.ts`: a pure `currentPhaseStatus(turn)` helper.
- `packages/engine/src/state.ts`: `activeTurnStatus(state)` (which player, which phase, which
  turn number) and a new `PlayerView.activeTurn` field carrying it — safe to expose to everyone,
  since it never carries order text.
- `packages/engine/src/actions/player.ts`: `endTurn`/`takeTurn` append a log line naming the new
  active player and phase.
- `packages/server/src/notifications.ts`: `turnEnded` mail reworded to name the phase.
- `packages/web/src/views/TurnPanel.tsx` (+ `.css`): per-phase Save button; Reveal saves first.
- `packages/web/src/views/GameView.tsx`: render the status in the title row.

**Out:**

- The Khalid turn-steal mechanic (filed as a follow-up, not implemented).
- Any change to when `yourTurn` moves, or to per-phase edit/lock permissions.
- Any change to the private log.

## Verification

`pnpm -r typecheck && pnpm -r test && pnpm -r build`, plus a browser pass if a server is
reachable in this session.
