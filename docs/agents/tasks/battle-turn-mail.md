# Battle turn email

- **Slug:** `battle-turn-mail`
- **Branch:** `feat/battle-turn-mail`
- **Owner:** Claude (orchestrator)
- **Status:** in progress

## Goal

When a combatant presses "end battle turn" in the battle arena, the player who
now has the battle turn gets an email straight away telling them it is their
turn to play a unit in the battle arena.

## Why

The human asked: "the person whose turn it is to play a unit should be told".
Constraints they gave, quoted in spirit:

- Send immediately. No cooldown, no throttle.
- Only on end battle turn, not on place, move, return or kill.
- Text along the lines of "It is your turn to play a unit in the battle arena".

## Scope

**In:**

- New `Notifications.battleTurn(game, previousTurnPlayerId)`-style method in
  `packages/server/src/notifications.ts`, no throttle.
- Call it from `POST /api/games/:gameId/battle/arena/turn/end` through the
  `after` hook, as `turnEnded` is used in `play.ts`.
- Tests in `packages/server/test/notifications.test.ts`.

**Out:**

- Mail for place, move, return, kill, initiate or end battle. Not asked for.
- Any engine change. `endBattleTurn` already flips `battle.turn`.

## Reference

No counterpart in the old system: `old-civ-rest` has no battle arena mail and
no arena at all. New mechanic; the human specified it.

## Approach

`endBattleTurn` flips `battle.turn` between `attacker` and `defender`. After it,
the recipient is `after.battle[after.battle.turn].playerId`. For the barbarian
side that is the player to the attacker's left, who controls the barbarians, so
they get the mail. Skip when the recipient equals the player who pressed the
button, or when `after.battle` is null. Use the existing private `notify`
helper without a throttle, so `disableEmail` and blank-address rules still
apply (unsubscribe is respected). Subject `Your battle turn`, body
`It is your turn to play a unit in the battle arena in <game name>!` plus the
game link, same style as `turnEnded`.

## Claimed paths

- `packages/server/src/notifications.ts`
- `packages/server/src/routes/arena.ts`
- `packages/server/test/notifications.test.ts`
- `docs/agents/tasks/battle-turn-mail.md`

## Acceptance criteria

- [ ] Ending the battle turn mails exactly the new turn holder, once, immediately.
- [ ] Two end-turns in a row within 30 minutes both send (no cooldown).
- [ ] No mail on place, move, return, kill, initiate, end battle.
- [ ] No mail to an unsubscribed player or one without an address.
- [ ] Barbarian side: the controlling player is mailed.
- [ ] A failing mailer does not fail the request.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: mail carries no unit or hand data; test asserts body has none.

## Open questions

None.
