# Movement may be written as "3+1"

- **Slug:** `issue-102-movement-text`
- **Branch:** `fix/issue-102-movement-text`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** done — review-approved (reviewer `deepseek/deepseek-v4-pro`; Sol
  unavailable, chosen by the human)
- **Issue:** <https://github.com/cash1981/playciv/issues/102>

## Goal

On the **Player status** board the Movement column accepts the shorthand the
players actually use at the table: a base speed plus a printed bonus, written as
`3+1` (natural religion gives an army figure one extra movement). Today the cell
is a numeric input and refuses anything but a bare integer, so the value cannot
be recorded.

## Why

The human filed issue #102:

> In player stats movement should be allowed to write 3+1. Since natural
> religion gives one extra movement speed on army figures, we typically write
> it as a + plus 1 sign. I am not allowed to do that now.

The status board (issue #43) is shared bookkeeping that replaces the old manual
spreadsheet; its values are never used in any calculation or rule. Movement is
the one column where the table shorthand is not a single number.

## Scope

**In:**

- The Movement cell accepts a value shaped `<base>(+<bonus>)*` — e.g. `2`, `3+1`,
  `2+1+1` — stored and shown exactly as typed.
- The engine validates Movement separately from the numeric stats and keeps
  rejecting anything else (`3+`, `+1`, `three`, an empty string, a negative
  number).

**Out:**

- Any change to the other stats (Coins, Trade, Culture, Units, Stacking, Combat,
  Hand Size, Investments); they stay integers.
- Any arithmetic or game-rule use of Movement. It remains pure bookkeeping, so
  a bonus is never added into a total anywhere.
- A structured base/bonus pair. The literal text is the value the players write;
  parsing it apart would invent a model nobody asked for.

## Reference

There is no old-system reference: Java had no status board and no movement
stat, and `old-civ-web` had no equivalent. This is a new field from issue #43,
so the only reference is the issue text above and the existing status-board
code.

## Approach

- `packages/engine/src/state.ts`: `PlayerStats.mvmt` becomes `string`; the
  default becomes `'2'`. Export `MOVEMENT_VALUE_PATTERN` and
  `isMovementValue(value)` so the engine and the client validate identically.
- `packages/engine/src/actions/player.ts`: `SetPlayerStatInput.value` widens to
  `number | string`. `setPlayerStat` keeps the integer rule for every key except
  `mvmt`; for `mvmt` it accepts a non-negative integer or a matching expression
  and stores the canonical string.
- `packages/engine/src/errors.ts`: `INVALID_STAT_VALUE.value` widens to
  `number | string`.
- `packages/engine/src/migrate.ts`: an older game with a numeric `mvmt` is
  normalised to its string form.
- `packages/server/src/routes/play.ts`: the `/stat` route accepts a string
  `value` as well as a number.
- `packages/web/src/views/StatusPanel.tsx`: `StatCell` gains a text mode used by
  the Movement column; it accepts the expression and rejects the rest, using the
  engine's validator.

## Claimed paths

- `packages/engine/src/state.ts` (`PlayerStats.mvmt`, default, and the new validator only)
- `packages/engine/src/actions/player.ts` (`setPlayerStat` only)
- `packages/engine/src/errors.ts` (`INVALID_STAT_VALUE` only)
- `packages/engine/src/migrate.ts` (status-board normalisation only)
- `packages/engine/test/player-stats.test.ts`
- `packages/server/src/routes/play.ts` (the `/stat` route only)
- `packages/server/test/api.test.ts` (the player-stats block only)
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/StatusPanel.test.tsx`
- `packages/web/src/lib/api.ts` (`setPlayerStat` signature only)
- `docs/agents/tasks/issue-102-movement-text.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`
- `README.md`

## Acceptance criteria

- [x] Typing `3+1` in a Movement cell and committing calls the API with the
      string `3+1` and the cell shows `3+1`
      (`StatusPanel.test.tsx`, mocked API; server round-trip below).
- [x] `setPlayerStat` accepts `2`/`4`, `3+1` and `2+1+1` for `mvmt`, and
      rejects `3+`, `+1`, `three`, `''`, `3 + 1` and `-1` with
      `INVALID_STAT_VALUE`.
- [x] The other stats still accept only non-negative integers (Combat may be
      negative), and a non-number for them is rejected — now a compile error as
      well, via the generic `SetPlayerStatInput`.
- [x] An older saved game with numeric `mvmt` migrates to its string form,
      while the other stats are untouched.
- [x] Hidden information: unchanged — stats were already public; the test in
      `player-stats.test.ts` still proves a hand does not leak alongside them.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
      (428 engine, 173 server, 72 web).
- [~] Verified end to end over HTTP against a local server (no desktop browser
      was connected, so the UI was exercised through the jsdom component test
      only): `mvmt` set to `3+1` returned `3+1`, survived a reload, logged
      `set their movement to 3+1`, and an invalid `3+` was rejected 400.

## Open questions

None that block. The one design choice — store the literal text rather than a
base/bonus pair — is recorded in `decisions.md`.
