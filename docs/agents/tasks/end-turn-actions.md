# End turn in "Your actions"

- **Slug:** `end-turn-actions`
- **Branch:** `feat/assisted-play-contract` (the human chose this branch; same PR #271)
- **Owner:** Claude (Sonnet 5.5)
- **Status:** in review

In a live game cash1981 pressed End turn twice and nothing seemed to happen: the
button in the Order tab marks one phase (Start of turn, then Trade), so cash1981
still held City management and Karandras1 was told it was not his turn. The human
confirmed the phase model is right, "End turn" is the name they want, and they want
the button in the action panel, as the first step of moving from the Order panel to a
pure action panel. Web only; the engine and the server are unchanged.

## What changes

1. **`EndTurn.tsx`** adds an End turn button at the top of "Your actions". It marks
   the viewer's earliest open phase in the active turn done (`api.markDone(gameId,
   phase, turnNumber)`), read from `activeTurn.waitingFor`. The turn and the phase are
   sent, so a stale page ends what the player saw and never a later phase.
2. **Label:** "End turn", aria-label "End turn: mark <Phase> as done". A line beside it
   says which phase it marks; on Research it adds that the next turn starts when every
   player has ended Research.
3. **Once the viewer has no open phase** the button is replaced by "You have ended
   turn N. Waiting for <names> (<phase>)." That line takes focus after the last press,
   only when focus was lost. There is no undo and no work ahead into the next turn in
   the panel; the Order tab keeps both.
4. **The panel shows for any player in a running game** (`hasActionsPanel`), even with
   no card action, choice or city. Not for a spectator, before the game starts or
   after it ends (`view.active === false`).
5. **Disabled** while the page is busy, replaying or locked (`readOnly`).
6. FAQ answer reworded: End turn is in Your actions and ends a phase.

## Not changed

- The Order tab's End turn and "Not done" button, the Turn and Phase pickers.
- `markPhasesDone`, `turnHolder`, the next-turn roll-over and the out of turn question.

## Files

- `EndTurn.tsx`, `EndTurn.test.tsx` (new), `AssistedActions.tsx`, `.css`,
  `GameView.test.tsx` (the old "no End turn button" assertion), `FaqView.tsx`,
  `decisions.md`, `state.md`.
