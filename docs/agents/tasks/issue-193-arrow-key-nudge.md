# Arrow-key nudge for selected board pieces

- **Slug:** `issue-193-arrow-key-nudge`
- **Branch:** `feat/issue-193-arrow-key-nudge`
- **Owner:** Claude
- **Status:** in progress (review round 1 found a design gap; see "Review round 1" below)

## Goal

With a piece selected on the board (a building, great person, hut, wonder, unit
or map tile — anything that can already be dragged), the player can nudge it
up, down, left or right by a small amount using the arrow keys, instead of
having to drag it with the mouse or touch. The nudge distance looks the same
on screen at any zoom level.

## Why

Issue #193 (human, verbatim): "You should be able to use arrow to move an item
up, down, left or right slightly at a time. It should be proportional to zoom
size. For instance moving a building or great person or hut."

Dragging a piece a short, precise distance is fiddly, especially at low zoom
where a few screen pixels of mouse movement cover a large board distance.
Arrow keys give a precise, repeatable nudge.

## Scope

**In:**

- A keydown handler in `BoardView.tsx`, active whenever a piece is selected
  (`selectedId !== null`), for `ArrowUp` / `ArrowDown` / `ArrowLeft` /
  `ArrowRight`.
- Applies to every piece category that can already be selected and moved —
  not just building/great person/hut, which the issue gives only as examples.
- The nudge step is a constant number of **screen** pixels, converted to board
  coordinates by dividing by the current `zoom` (mirroring `toBoard`'s
  `/ zoom`), so one press moves the piece the same visible distance regardless
  of zoom level.
- Each keydown (including the browser's own key-repeat while the key is held)
  calls `api.movePiece(gameId, selected.id, x, y)` through the existing `run`
  prop, exactly once per event — the same one-call-per-step shape the pointer
  drag path already uses. No debouncing or batching.
- `preventDefault()` on the handled arrow keys so the page/scroll container
  does not also scroll.
- Respects the existing guards: no-op when `busy || readOnly`, and no-op if
  keyboard focus is inside a form control (input/textarea/select) elsewhere on
  the page, so typing in, say, a chat box does not move the board piece.
- The nudge bypasses the player-area "tidy into next free grid slot" snap and
  the map-tile "snap to nearest slot" behaviour (see "Review round 1" below) —
  a nudge always moves the piece by exactly the requested step, still clamped
  to stay on the board. Dragging a piece with the mouse into an area or onto
  the map keeps tidying/snapping exactly as it does today; only the keyboard
  nudge path is exempt.

**Out:**

- Any modifier-key variant (Shift for a bigger step, etc.) — not asked for.
- Changing the drag-and-drop or tap-to-move paths.
- Any new keyboard shortcut beyond the four arrow keys (e.g. Delete-to-remove).
- Touch/on-screen controls — this is a physical-keyboard feature.

## Reference

None. Confirmed by search: `old-civ-web` (AngularJS) has no board/map view at
all — no controller, no view, and no keyboard handling on anything resembling
a map. The pixel-coordinate drag board is new in this rewrite, so there is
nothing to port; the design decisions below were settled directly with the
human rather than by precedent (see "Open questions", now answered).

## Approach

**Engine** (`packages/engine/src/actions/board.ts`):

- Add an optional field to `MovePieceInput`, e.g. `snap?: boolean` (default
  behaviour when omitted is unchanged: snapping applies, exactly as today —
  this keeps every existing caller and every existing test working
  untouched).
- In `movePiece`, when `input.snap === false`, skip the `areaAt`/
  `nextFreeSlot` branch and the `tile`/`civtile` → `nearestSlotOrigin` branch
  entirely; go straight to `clampToBoard(state.board, input.x, input.y,
  piece.width, piece.height)`. Everything else (z-ordering, the `from`/`to`
  location strings, the `moved`/`nudged` log wording, history recording) stays
  as it is.
- Add a short comment at the new branch explaining why: the keyboard nudge
  wants the piece to move by exactly the requested amount, not be re-tidied
  into a grid slot the way a mouse drop into an area is (issue #193).

**Server** (`packages/server/src/routes/board.ts`, plus
`packages/server/src/context.ts` for a small shared helper):

- Add `optionalBoolean(body, key)` to `context.ts`, next to the existing
  `optionalString`/`optionalNumber` helpers, same shape: reads `body[key]`,
  returns it only if it is actually a boolean, otherwise `undefined`.
- In the `/move` route, read `const snap = optionalBoolean(body, 'snap')` and
  pass `snap` through to `movePiece`'s input (`undefined` when the client did
  not send it, which keeps existing snapping behaviour for every other
  caller).

**Client** (`packages/web/src/lib/api.ts`, `packages/web/src/views/BoardView.tsx`):

- `api.movePiece` gains a 5th, optional parameter, e.g. `snap?: boolean`;
  when provided, send it in the POST body alongside `x`/`y`. Every existing
  call site (the drag-and-drop path, tap-to-move) is left as a 4-argument
  call, so its behaviour does not change.
- The arrow-key handler in `BoardView.tsx` calls
  `api.movePiece(gameId, selected.id, x, y, false)` — the only call site
  that opts out of snapping.
- Everything else about the handler is unchanged from before:
  - `useEffect` gated on `selectedId !== null`, a `document.addEventListener('keydown', ...)`.
  - Returns early unless `event.key` is one of the four arrow keys.
  - Returns early if `busy || readOnly`.
  - Returns early if `document.activeElement` is an `input`, `textarea` or
    `select` (or has `isContentEditable`).
  - Computes `dx`/`dy` in board coordinates from a fixed `NUDGE_STEP_PX`
    constant (screen pixels) divided by `zoom`.
  - **New:** before calling `run`, import `clampToBoard` from `@civ/engine`
    (already re-exported via `packages/engine/src/index.ts`'s
    `export * from './board.js'`) and call
    `clampToBoard(board, x + dx, y + dy, selected.width, selected.height)`.
    Skip the `run`/`api.movePiece` call entirely if the clamped result equals
    the piece's current position — mirror the existing drag path's "a plain
    click without movement should only select, not send a request" check
    (`onPiecePointerUp`). No duplicated clamp math.
  - `preventDefault()` only on the keys actually handled.

## Claimed paths

- `packages/engine/src/actions/board.ts`
- `packages/server/src/context.ts`
- `packages/server/src/routes/board.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/BoardView.test.tsx`
- Engine/server test files covering `movePiece` and the `/move` route (see
  `packages/engine/test/board.test.ts` and the server board route tests)

## Acceptance criteria

- [ ] Selecting a piece and pressing an arrow key moves it one small, visible
      step in the expected direction, at both a high and a low zoom level, and
      the step looks the same size on screen at both.
- [ ] This holds for a piece sitting inside a player area (e.g. a collected
      hut) and for a map tile — not just a freely-placed piece: the nudge
      moves it by exactly the requested step, it is not re-tidied into a grid
      slot or re-snapped to the nearest tile position. Covered by an engine
      test on `movePiece` with `snap: false` against a piece placed inside a
      player area.
- [ ] Holding an arrow key down moves the piece repeatedly (OS auto-repeat).
      Each repeat that is not still waiting on a prior request in flight
      reaches the server; one arriving mid-request is dropped by the existing
      `busy` guard, same as any other board action while `run` is in flight —
      this is expected, not a bug, and does not need fixing.
- [ ] Pressing an arrow key with no piece selected leaves the browser's
      default behaviour alone (e.g. the page may scroll) — our handler is not
      even attached in that state.
- [ ] Pressing an arrow key while `readOnly` or `busy` does nothing.
- [ ] Pressing an arrow key while focus is in an unrelated text input does not
      move the board piece and does not block that input's own arrow-key
      behaviour (e.g. moving the text cursor).
- [ ] A piece nudged toward the edge of the board is clamped there
      (`clampToBoard`), same as any move; a nudge that would not change the
      piece's position at all (already at that edge) does not call the server,
      mirroring the drag path's own no-op-click guard.
- [ ] A test proves the success path calls `event.preventDefault()` (not just
      that the no-op paths leave it uncancelled).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not applicable — this only changes where an already-
      visible piece sits, the same information `movePiece` already exposes.
- [ ] Verified in the browser: nudge a piece at two different zoom levels and
      describe what was seen.

## Open questions

Settled with the human before starting:

- **Scope of piece types:** all movable pieces, not only building/great
  person/hut.
- **"Proportional to zoom" meaning:** constant on-screen step, converted by
  dividing by zoom — not a constant board-coordinate step.
- **Key repeat:** one `movePiece` call per keydown event, including
  auto-repeat; no throttling (this holds; the `busy` guard dropping a repeat
  mid-request is a separate, pre-existing mechanism, not throttling added for
  this feature).
- **Activation:** live whenever a piece is selected, not gated on the board
  surface itself having focus.

## Review round 1

The first implementation sent the nudged `x`/`y` straight to the existing
`movePiece`, unchanged. The reviewer found this reducer already re-snaps a
piece dropped inside a player area into the next free grid slot
(`nextFreeSlot`, `packages/engine/src/board.ts`) regardless of the position
requested, and snaps a map tile to its nearest slot — both irrespective of
direction. For a piece sitting in either place (a common state for exactly the
piece types the issue names — a collected hut, a great person), an arrow press
could move it sideways to an unrelated free slot, or do nothing at all.

Settled with the human: the nudge should bypass both snaps. `movePiece` gains
an opt-in `snap: false` input, used only by the keyboard-nudge call; drag-and-
drop into an area or onto the map is unaffected and keeps tidying/snapping
exactly as before. See "Approach" above for the engine/server/client plumbing
this requires, and the updated "Claimed paths" and "Acceptance criteria".

The reviewer's other findings (all addressed in the same round, no further
human decision needed):

- No-op nudges (already at the board edge) should not call the server, same
  as the drag path's existing no-op-click guard.
- Add a test proving the success path calls `preventDefault()`.
- Match the repo's `switch` body style (own line per case, not `case X: y; break`).
- The task-board claim must list every path actually touched, including test
  files.

## Review round 2

Verdict: approve with nits, plus one real gap. Round 2's fix
(`packages/engine/src/actions/board.ts`'s `snap: false` bypass, plumbed
through the server and `api.ts`, and `BoardView.tsx`'s client-side no-op
clamp) was verified correct: both snaps are genuinely bypassed only when
`snap === false`, every existing caller is unaffected (confirmed by grep and
by the pre-existing drag/tap tests' exact-arity `toHaveBeenCalledWith`
assertions), the client/server clamp is idempotent so the two sides can never
disagree, and the new engine/server tests are load-bearing (they fail if the
bypass is removed, not just green by construction).

**Gap to close (round 3):** no test asserts that
`BoardView.tsx`'s nudge call site actually passes `false` as `api.movePiece`'s
5th argument. Deleting that one argument — the single line connecting the
whole fix to the feature — leaves the entire suite green while reintroducing
the exact round-1 bug. Fix: in the existing direction test (piece at
`(200, 400)`, clear of the clamp), assert the full call, e.g.
`expect(movePiece).toHaveBeenCalledWith('game', boardPiece.id, expect.any(Number), expect.any(Number), false)`.

Left as nits, to be closed by the orchestrator at finish rather than sent back
to the coder:

- `README.md`'s board section says an area drop always tidies and a map drop
  always keeps its exact position; that is now only true of pointer
  drops — the keyboard nudge is a deliberate exception. Needs a sentence.
- No `decisions.md` entry yet for the snap-bypass design decision (precedent:
  the 2026-09-17 culture-track-markers entry). To be added at finish.
- `optionalBoolean` doesn't accept the string `"false"` the way
  `optionalNumber` accepts numeric strings — safe today (only client sends a
  real boolean) but an asymmetry worth knowing about if reused elsewhere.
- The new tile test in `board.test.ts` uses bare pixel literals rather than a
  helper — cosmetic, the test still fails loudly on a real geometry change.
