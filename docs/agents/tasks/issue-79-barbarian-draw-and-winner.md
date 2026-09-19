# Arena: barbarians auto-draw only, and show the battle winner

- **Slug:** `issue-79-barbarian-draw-and-winner`
- **Branch:** `fix/issue-63-arena-ux` (continuation of the still-open PR #67)
- **Owner:** Claude (Sonnet 5)
- **Status:** done

## Goal

Two small, related arena fixes from
[issue #79](https://github.com/cash1981/playciv/issues/79):

1. Drop the manual "Draw 3" barbarian button — `initiateBattle` already draws
   3 barbarian units automatically for the player to the initiator's left,
   so a standalone draw button only invites drawing ahead of time (or twice)
   for no reason. The "Discard" button stays.
2. When "End battle" is pressed, log which side won: each side's remaining
   HP (excluding killed units) plus its combat bonus, higher wins, a tie
   goes to the defender.

## Why

Direct request from the human:

> I think we can remove the draw barbarian buttons button. Since we now
> start fighting using the start fight button, there is no need to draw 3
> barbarians. They will automatically be drawn and should only be visible to
> the player to the left.
>
> [...] Only discard barbarians manually by using the discard button. That
> way it will be revealed to all other players. The battle arena by the way
> should be publicly readonly available to all.
>
> Also when the end battle button is pushed, display a message with for
> instance "Cash won the battle with 5 HP vs 2 HP". You can calculate this by
> taking the remaining HP and adding any combat bonus for that player.
> Barbarians have no combat bonus, but opponents might.
>
> btw, if battle is drawn, defender always wins

The "arena is publicly readonly available to all" and "barbarians only
visible to the player to the left" points are both already true of the
existing code (`state.ts`'s `battle` field is public on `PlayerView`; a
player's `barbarians` list is only ever exposed in full to that player, via
`OpaquePlayerhand.numberOfBarbarians` for everyone else) — no change needed
there, confirmed by reading `packages/engine/src/state.ts`.

## Scope

**In:**

- Remove the "Draw 3" button and its dead server route/API client method.
- Keep the "Discard" button (bulk-discards the barbarian hand, revealing it).
- Compute and log a battle winner in `endBattleAction`.

**Out:**

- Any change to how barbarians are drawn (`drawBarbarians` the engine
  function is unchanged — still called from `initiateBattle`).
- Using `combatBonus` for anything other than this winner calculation; it
  remains the manually-edited, non-engine-affecting status-board stat from
  issue #43 (see `decisions.md`, 2026-09-17 entry).

## Reference

New construct, no counterpart in the old system — confirmed by search: the
old backend's `DrawAction.endBattle` only clears `inBattle` on the caller's
units, and the old AngularJS `battle.html` has no HP display, no winner
banner, and no "arena" concept at all. Specified directly by the human.

## Approach

- `packages/web/src/views/GameView.tsx`: remove the "Draw 3" button from the
  Barbarians panel.
- `packages/web/src/lib/api.ts`: remove `drawBarbarians`.
- `packages/server/src/routes/play.ts`: remove the
  `POST /api/games/:gameId/battle/barbarians` route and its now-unused
  `drawBarbarians` import (the engine function itself is untouched, still
  used internally by `initiateBattle`).
- `packages/engine/src/state.ts`: export `battleSummaries` (was
  module-private) so `endBattleAction` can reuse its per-side HP/combat-bonus
  totals instead of duplicating the calculation.
- `packages/engine/src/actions/arena.ts`: `endBattleAction` computes
  `totalHealth + combatBonus` for each side (via `battleSummaries(state)`,
  called before the arena is cleared), picks the higher score as the winner
  (ties go to the defender), and appends it to the existing "ends the battle"
  public log line, e.g. `cash1981 ends the battle — cash1981 won with 5 HP
  vs 2 HP`.

## Claimed paths

- `packages/web/src/views/GameView.tsx`
- `packages/web/src/lib/api.ts`
- `packages/server/src/routes/play.ts`
- `packages/engine/src/state.ts`
- `packages/engine/src/actions/arena.ts`
- `packages/engine/test/arena.test.ts`

## Acceptance criteria

- [x] The Barbarians panel has only a "Discard" button, no "Draw 3".
- [x] `initiateBattle` against barbarians still auto-draws 3 units for the
      left-side player, unchanged.
- [x] Ending a battle logs the winner: higher (remaining HP + combat bonus)
      wins; a draw goes to the defender.
- [x] Barbarians have a combat bonus of 0 always; a player's combat bonus
      comes from `PlayerStats.combat` (issue #43), unchanged by this task.
- [x] No route or client method remains for the removed manual draw
      (`POST /battle/barbarians` and `api.drawBarbarians`).
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: unaffected — this task does not change what is
      exposed in any projection, only removes a UI control and adds a public
      log line already built from public `battleSummaries` data.

## Open questions

None outstanding — the human answered the two open design points (keep
Discard; remove the dead route/client) directly via `AskUserQuestion`, and
supplied the winner and tie-break rule directly in chat.
