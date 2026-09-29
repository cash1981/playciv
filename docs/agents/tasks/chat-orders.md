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
