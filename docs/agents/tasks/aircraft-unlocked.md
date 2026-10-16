# Aircraft unlocked in Player status

- **Slug:** `aircraft-unlocked`
- **Branch:** `feat/aircraft-unlocked`
- **Owner:** Claude
- **Status:** in progress

## Goal

Under **Units** in the Player status table, each player has an **Aircraft**
checkbox meaning "this player has unlocked building aircraft units". It is set
automatically when the player reveals the Flight tech (which unlocks Aircraft),
and anyone in the game can still tick or untick it by hand, like every other
status value.

## Why

Human: "Jeg har glemt å be om at airplane blir lagt til i player status under
units. Det må være en typ true/false, at man har unlocket muligheten å bygge det.
Så kanskje bare en checkbox som automatisk blir satt på når man revealer
airplane."

## Scope

**In:**

- New boolean `PlayerStats.aircraft` (default `false`), migrated for old saves.
- `setPlayerStat` accepts it (boolean only); the server route forwards booleans.
- `revealTech` sets it when `Flight` is revealed for the first time.
- Checkbox column in the Units group of `StatusPanel`.

**Out:**

- Clearing the flag when Flight is removed or hidden again: the board is
  permissive bookkeeping and the checkbox can be unticked by hand.
- Enforcing the flag on draws (Aircraft draws stay unrestricted).

## Reference

`decisions.md` → "Board and manual bookkeeping". Flight's text in
`packages/web/src/views/techText.ts` says "Unlocks: Aircraft units".

## Approach

Engine `state.ts`/`migrate.ts`/`actions/player.ts`, server `routes/play.ts`,
web `lib/api.ts` and `StatusPanel.tsx`, plus tests in each package.

## Claimed paths

- `packages/engine/src/state.ts` (`PlayerStats` only)
- `packages/engine/src/migrate.ts`, `packages/engine/src/actions/player.ts`
- `packages/engine/test/player-stats.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/web/src/lib/api.ts`, `packages/web/src/views/StatusPanel.tsx`, `packages/web/src/styles.css`
- `packages/web/src/views/StatusPanel.test.tsx`
- `docs/agents/decisions.md` (Board and manual bookkeeping)

## Acceptance criteria

- [ ] Checkbox in Units group, checked after revealing Flight, editable by hand
- [ ] Old saves load with `aircraft: false`
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: the flag is public status; a hidden Flight does not set it
