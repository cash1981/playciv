# Merge chat and turn orders (issue #215)

- **Slug:** `chat-orders`
- **Branch:** `feat/chat-orders`
- **Owner:** Claude (orchestrator), coder role for slices
- **Status:** approved by the human (slicing and out-of-turn draws)
- **Issue:** https://github.com/cash1981/playciv/issues/215 (the issue body is the
  spec; this brief is the plan and the slicing)

## Goal

A game with **Chat orders** switched on has one timeline instead of a Chat panel
and a Turn orders panel. A message is chat or an order tagged with a turn and a
phase. Players mark phases done (and can unmark them). The game title says who it
is waiting for. When everyone has finished Research, the next turn starts by
itself and the start player marker moves. Switching the setting off gives the
classic panels back with no lost data.

## Why

The human: "I have gotten complaints that turn order and chat is a bit
confusing." It is an experiment: "I want the option to revert these changes if I
feel its not something I want." So the toggle and data compatibility are the
constraint that shapes everything below.

## Slices (three pull requests, in this order)

Splitting is deliberate. The issue touches engine state, the chat store, the
board, e-mail and most of the game screen. One PR would be unreviewable.

1. **Engine and server, no new UI.** Setting, done markers, order messages,
   turn status, paged chat endpoint.
2. **Web: the merged timeline.** Composer, done sheet, filters, Load more,
   Private tab, admin switch, mobile.
3. **Automatic new turn and the start player marker.**

Slice 1 is what to build first and what this brief details.

## Scope (slice 1)

**In:**

- `GameState.chatOrders: boolean`, default `false`, settable **only by an admin**
  (new admin route). Old saved games migrate to `false` (`migrate.ts`).
- `PlayerTurn.done: Record<TurnPhase, boolean>`, separate from `revealed`. A
  phase can take several messages, so sending an order does not mean done. Old
  turns migrate with `done = revealed`.
- Engine actions: `markPhasesDone(playerId, turnNumber, upToPhase)` (several
  phases in one go), `unmarkPhaseDone(playerId, turnNumber, phase)` (no vote,
  does not touch later phases), and `postOrder` (writes the order for the phase
  and publishes it at once: `orders[phase]` is always the newest, `history`
  keeps every version, so the classic panel reads the same data).
- Classic reveal also sets `done` for that phase, so switching modes agrees.
- A pure `turnStatus(state)`: per active player the first phase not done in the
  current turn; the current turn is the lowest turn where someone has not
  finished Research; the `waiting for` list. Withdrawn players are skipped.
  `activeTurn` in `PlayerView` uses it when `chatOrders` is on; unchanged when
  off.
- Server: `ChatMessage` gains `kind` (`chat | order | system`), `turnNumber`,
  `phase`. Posting an order goes through `applyToGame` so engine state and the
  timeline row are written together. Done / unmark / new turn write `system`
  rows. `GET /chat` becomes paged: default returns the whole current turn (at
  least 30 messages), `before=<cursor>` returns the previous turn.
- D1 migration `0004` in `packages/worker/migrations`, and the `json-file`
  store, with old rows reading as `kind = chat`.

- **Out-of-turn draws.** With `chatOrders` on, `draw` and the other actions that
  call `requireYourTurn` (`draw.ts` lines 70 and 234) no longer refuse an
  out-of-turn player outright. They return `NOT_YOUR_TURN` unless the input
  carries `confirmedOutOfTurn: true`; the web dialog (slice 2) asks and resends.
  "Your turn" in chat mode is derived, not the baton: the first player, in seat
  order from the start player, who has not marked the earliest open phase done
  (`turnHolder(state)`). With `chatOrders` off nothing changes.

**Out (and why):**

- Any web change: slice 2.
- Rotating the marker, automatic new turn, following manual marker moves: slice
  3, because they need the board and a decision on the `yourTurn` baton (below).
- E-mail rule: issue #217.
- Enforcing phase order: the human said the system only shows who is missing
  what.

## Reference

New feature, so no old-system rules to port. What exists: turn orders in
`packages/engine/src/turn.ts` and `actions/turn.ts` (Java `TurnAction`), chat in
`packages/server/src/routes/games.ts` (Java `GameAction.addChat`), the current
baton `endTurn` in `actions/player.ts`. The start player marker is the board
asset `markers/startplayer`. Player areas come from `playernumber`
(`playerAreas` in `board.ts`), so "which player's area is the marker in" is
computable. No FFG rule is being invented: the only rule involved is the
marker moving to the next seat clockwise, which the human confirmed (playernumber
order).

## Hidden information

- Orders are public in chat mode, so nothing new is exposed there.
- The private log (`gamenote`) must still reach only its owner. Slice 2 moves it
  into a Private tab; slice 1 adds no projection change, but any new field on
  `PlayerView` gets a leak test.
- `done` flags are public (like `revealed`).

## Claimed paths (slice 1)

- `packages/engine/src/turn.ts`, `state.ts`, `migrate.ts`, `actions/turn.ts`, `actions/draw.ts`, `errors.ts`
- `packages/engine/test/` (new turn-status and done tests)
- `packages/server/src/routes/games.ts`, `routes/play.ts`, `routes/admin.ts`
- `packages/server/src/store/types.ts`, `d1.ts`, `json-file.ts`
- `packages/worker/migrations/0004_chat_kind.sql`
- Shared resource: `packages/engine/src/state.ts` (`PlayerView` shape)

## Acceptance criteria (slice 1)

- [ ] Out-of-turn draw with `chatOrders` on: refused without `confirmedOutOfTurn`,
      allowed with it; with `chatOrders` off always refused as today
- [ ] `chatOrders` off: behaviour and API responses identical to today
- [ ] Admin can turn it on and off; a non-admin gets 403
- [ ] Mark several phases done in one call; unmark one without touching later
      ones; `turnStatus` and `activeTurn` follow at once
- [ ] Two orders for the same player, turn and phase: both in `history`, newest
      in `orders`, both appear in the paged timeline
- [ ] Turning the setting off and on loses nothing; classic reveal sets `done`
- [ ] `GET /chat` returns the whole current turn, `before` returns the previous
- [ ] Old chat rows and old saved games load (migration tests)
- [ ] No leak: a test that another player's `PlayerView` carries no private log
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass

## Open questions

1. ~~Drawing is gated by `yourTurn`.~~ **Decided by the human:** with chat orders
   on, a player who draws out of turn gets a warning dialog and must confirm.
   See "Out-of-turn draws" above.
2. Where is the admin switch shown? Recommendation: the existing **Actions**
   submenu in the menu (admin only), with a confirmation.
3. When the setting is turned on, is the start player marker placed
   automatically in player 1's area if it is not on the board? Recommendation:
   yes, slice 3.
4. New turn state: store the start player per turn (`turnStarters`) so the title
   for an old turn stays correct after the marker moves, or derive from the
   marker only? Recommendation: store it, and let the marker update it.

---

## Decision 2026-09-29: one pull request

The human wants slices 1, 2 and 3 in the same PR (#218) so the feature can be
tested as a whole, and cannot test before there is UI. Work continues on
`feat/chat-orders`. Order: slice 2 (web), so there is something to test, then
slice 3.

## Slice 2: web (the merged timeline)

Shown instead of `TurnPanel` and `ChatPanel` when `view.chatOrders` is true.
With it off, nothing changes.

**In:**

- API client: `ChatMessageDto` gets `kind`, `turnNumber`, `phase`; `PlayerView`
  and `activeTurn.waitingFor`; `chatPage(gameId, before?)` (calls `GET /chat?paged=1`),
  `postOrder`, `markDone`, `unmarkDone`; `draw` and `drawWonder` accept
  `confirmedOutOfTurn`.
- `ChatOrdersPanel`: one timeline, oldest at the top and the composer at the
  bottom, scrolled to the newest; "Load more" at the top fetches the previous
  turn (`before` = oldest loaded id) and merges by id; the auto-refresh refetches
  the current page and merges. Filter chips All / Orders / Chat / Private.
- A message shows civilization (small), nickname (bold, in the player's colour
  using the existing `player-*` classes), time, and the markdown body rendered
  safely (no raw HTML, no `javascript:` links). Orders carry a `T4 · SOT` tag and
  a "replaced" note when the same player has posted a newer order for the same
  turn and phase (the newest counts). `system` rows are centred and quiet.
  Left border in the player's colour.
- Composer: Chat / Order switch. Order shows Turn and Phase selects, defaulting
  to the viewer's current turn and first phase not done, both changeable. The
  text field is the existing `MarkdownEditor` (injectable like `TurnPanel` does,
  for tests). A Send button.
- Done control: opens a sheet ("Mark phases done"): pick a turn (default current)
  and "done up to" phase (marks all phases up to it); phases already done are
  shown and tapping one unmarks it. Uses `markDone` / `unmarkDone`.
- Private tab: the private log (`gamenote`), reusing `PrivateLogWorkspace`.
- Game header: when `chatOrders`, the title reads `Turn N: waiting for Bob (SOT),
  Carol (Trade)` from `activeTurn.waitingFor`; a small status strip shows every
  player with a colour dot and their current phase. End turn and Take the turn
  buttons are hidden.
- Out-of-turn draw: when `chatOrders` and the viewer is not `activeTurn.playerId`,
  Draw asks in a confirm dialog ("It is not your turn. X is up. Draw anyway?")
  and sends `confirmedOutOfTurn: true` only after Yes. The draw panel is not
  disabled in chat mode. The Status table's "turn" tag follows `activeTurn`.
- Admin switch: in the menu's Actions submenu, a "Chat orders: on / off" item
  for admins only (not the creator), with a confirmation dialog, calling
  `POST /api/admin/games/:gameId/chat-orders`.
- Replay and ended games: the panel is read-only when the game is replaying or
  locked, like the existing panels.
- Mobile first (375px): sticky composer, no horizontal scroll, controls at least
  44px high, checked in the browser.

**Out:** the automatic new turn, marker rotation, turn divider rows (slice 3).

## Slice 3: new turn, start player marker, turn mail

**Model.** The start player is derived, so manual moves, undo and redo cannot
leave it stale:

- `startPlayerOf(state)`: the owner of the player area that contains the centre
  of the `markers/startplayer` board piece; if the marker is missing or in no
  player's area, `GameState.startPlayerId` (last known); if that is unset,
  playernumber 1. Withdrawn players are skipped (fall through to the next seat).
- `GameState.startPlayerId: string | null` (default null, migrated to null) is
  written whenever the engine starts a turn, and by `setChatOrders(true)`.
- `GameState.turnStarters: Record<number, string>` (turn number to username):
  who started each turn, so the title of an old turn stays right after the marker
  moves. Migrated to `{}`.
- `turnHolder` uses the seat of `startPlayerOf(state)` instead of the fixed
  seat 1 (the draw guard follows).

**Enabling.** `setChatOrders(true)` places the marker in the start player's
area if the board has none (`placeUnchecked`, area origin), and records
`turnStarters[startTurn]`. It needs an `at` for the board history; the admin
route supplies it.

**New turn.** In `markPhasesDone`, after marking: if `turnStatus.currentTurn`
went from N to N+1 and `turnStarters[N+1]` is not set, then start turn N+1:
the next start player is the next playernumber after `startPlayerOf(state)`
among active players, wrapping (clockwise); move the marker into that player's
area (a board history entry, undoable); set `startPlayerId` and
`turnStarters[N+1]`; write the public log line `Turn N+1: <player> starts with
the Start of turn phase`. The `turnStarters[N+1]` guard matters: unmarking a
Research and marking it again must not rotate twice. Unmarking never rolls a
started turn back.

**Manual marker moves.** Nothing to do for the rule itself (it is derived). When
`movePiece` moves the start player marker into a different player's area while
chat orders is on, write a public log line `<player> is now the start player`.

**Status.** `ActiveTurnStatus` gains `startPlayer: string | null` (username,
from `turnStarters[currentTurn]` else `startPlayerOf`) when chat orders is on.

**Server.** When `currentTurn` increases after a `turns/done` call, also write a
`system` chat row for the new turn (kind `system`, turnNumber N+1, phase `SOT`,
text `Turn N+1: X starts with the Start of turn phase`). Slice 1's paging
boundary ("first row tagged with the current turn") then becomes exact.
Mail: in chat mode, when the turn holder changes after `turns/done`, notify the
new holder ("It is your turn: <phase>, turn <n>") through the existing in-game
notification path and its 30 minute throttle (#217 will change the throttle for
every mail; do not build that here). No mail when the holder does not change.

**Web.** The title reads `Turn N · <starter> started · waiting for ...`. A
`system` row that starts a turn renders as a turn divider in the timeline.

**Acceptance.**

- [ ] Last player marks Research: turn N+1 starts, marker moves to the next seat
      clockwise, log line written, `turnStarters` set, title updated
- [ ] Unmark then mark Research again does not rotate a second time
- [ ] Marker dragged into another player's area: that player is start player,
      the next rotation counts from them; marker in no area: last known
- [ ] Enabling with no marker on the board places one; with a marker leaves it
- [ ] Withdrawn players are skipped in rotation and in the holder
- [ ] Undo of the marker move or the turn start restores the previous start player
- [ ] Off: no marker is placed, nothing changes
- [ ] Hidden information: `startPlayer` and `turnStarters` are public; a test
      shows a projection carries no private field

---

## Changes since this brief

The sections above are the plan. This is what the feature does now, where it
differs. The code and `docs/agents/decisions.md` are the reference.

- **No Done sheet and no "one turn ahead".** The Done button, the sheet and the
  "Done up to" picker were removed. Marking a phase done is one **End turn**
  button on the **Order** tab of the composer. It marks the phase chosen in the
  Phase list, in the turn chosen in the Turn list, and reads **Not done** (which
  unmarks it) when that phase is already done. Its accessible name starts with
  the visible words: `End turn: mark City management as done`, `Not done: unmark
  Trade as done`. There is no button on the Chat tab.
- **The Turn list holds only turns the viewer has reached.** It runs from turn 1
  to the viewer's own turn: the first turn at or after the game's current turn in
  which the viewer has not marked Research done. A player who has finished
  Research moves on to the next turn without waiting for the others; the game's
  turn still waits for everyone. A later turn can not be picked, and a turn the
  viewer skipped over does not move the default past it.
- **Done phases are struck through in the Phase list**, in the text itself with
  combining marks, because a native option cannot be styled everywhere. There is
  no check mark.
- **A simple formatting bar in the composer** (Normal, Heading, bold, italic,
  with names on the buttons). The Private tab keeps the editor's full bar. The
  editor's fixed top bar is not used in the composer.
- **The title is `Turn N · <name>'s turn — <phase> phase`**, or `Your turn` for
  the holder, and `Turn N · everyone is done` when nobody is waiting. Who is
  missing what is the status strip under the title, not the title. (The brief said
  `Turn N · <starter> started · waiting for ...`.)
- **The message header reads `Greeks - nickname`**, the civ small, both in the
  player's colour.
- **Turns start as a catch-up.** `startMissingTurns` runs after marking a phase
  done, after a classic reveal and after a withdrawal. It starts every turn
  between the newest one with a starter and the current turn, one seat of
  rotation each, so a jump of more than one turn leaves no gap in `turnStarters`.
  `turnStarters[N]` still stops a turn from being started twice.
- **An order is mailed like a chat message** (same method, same hold until the
  player opens the game). The turn holder is mailed when it changes after a done.
- **The Markdown renderer loads on demand**, so a game without chat orders does
  not carry react-markdown.
- **Filter tabs follow the tab pattern**: `aria-controls`, one tab stop, and
  arrow keys, Home and End.
