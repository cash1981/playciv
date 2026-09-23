# Board tap-to-move on touch

- **Slug:** `board-tap-to-move`
- **Branch:** `feat/board-tap-to-move`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** claimed

## Goal

On a phone or tablet, tapping an existing piece on the board and then tapping a
destination on the board moves the piece there, exactly like the palette flow
(tap a palette asset, then tap the board). Touch dragging and board panning keep
working.

## Why

The human reports that on mobile you cannot tap a piece and then tap somewhere
else on the map to move it; you have to drag it. The palette asset flow does
work, so the two flows are inconsistent. The state file (`state.md`, issue #115)
still says "selecting an existing piece immediately arms move mode so the next
board tap moves it", but commit `93bf305` ("Make map taps deselect touch
pieces") removed that arming: today the first touch only selects, a board tap
deselects, and only a second tap on the marked piece or a drag can reach the
Move button's flow.

## Scope

**In:**

- A first touch on an existing board piece selects it and arms destination mode
  in one tap.
- The next completed tap on the board surface (map, player area, or on top of
  another piece — destination semantics, like the palette flow) sends the
  existing `movePiece` request centred at the tapped board coordinate.
- The armed state is visible: the existing "Moving <piece> / Tap a destination
  on the board / Cancel" status panel appears right after the first tap.
- Touch-dragging the marked piece still drags it, with the existing 6 px
  movement tolerance; a drag that actually moves the piece disarms destination
  mode so a later stray tap does not move it again.
- An 8 px swipe on the board surface still pans/scrolls and sends nothing; a
  second pointer or `pointercancel` still cancels the tap.
- Tapping outside the board, the Cancel button, arming a palette asset,
  removing a piece and replay (`readOnly`) all keep their current behaviour.

**Out:**

- Any change to the palette flow, drag-and-drop, zoom, rotation, undo or the
  engine, server or API contracts.
- CSS changes; `styles.css` is claimed by other live work and the interaction
  needs none.

## Reference

The pre-`93bf305` implementation (commits `02c920b` and `7cbb4a7`) is the
reference for the touch arming, and the merged battle arena's select-piece /
tap-slot flow (`GameView.tsx`, `handleSlotClick`) is the same interaction model.
No game rule is involved.

## Approach

In `onPiecePointerDown`, the touch branch that previously only selected now
also calls `setMoveModeId(piece.id)` before returning, so the existing
`onSurfacePointerUp` destination path runs on the next board tap. In
`onPiecePointerUp`, a drag that moved the piece clears the move mode. Tests in
`BoardView.test.tsx` cover the arming, the destination move, destination
semantics over another piece, deselection outside the board, and the
disarm-after-drag regression.

## Claimed paths

- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/BoardView.test.tsx`
- `docs/agents/tasks/board-tap-to-move.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] One touch on a piece selects it and shows the "Moving" status.
- [ ] The next tap on the board sends `movePiece` with the tapped coordinate.
- [ ] Tapping another piece while armed moves onto it rather than selecting it.
- [ ] Touch drag of the marked piece still moves it; panning still works.
- [ ] Tapping outside the board clears the selection without a move.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in a mobile-sized browser viewport, with the result reported
      honestly if no browser is available.

## Open questions

None. The human asked for exactly the palette-like tap-then-tap flow.
