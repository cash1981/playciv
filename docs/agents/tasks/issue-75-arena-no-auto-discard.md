# Arena: end battle should return killed units to hand, not auto-discard

- **Slug:** `issue-75-arena-no-auto-discard`
- **Branch:** `fix/issue-63-arena-ux` (continuation of the still-open PR #67)
- **Owner:** Claude (Sonnet 5)
- **Status:** done

## Goal

Revert the auto-discard-on-end-battle behaviour added in issue #71, per
[issue #75](https://github.com/cash1981/playciv/issues/75) — the human's
direct clarification:

> Fortsatt er det en bug når jeg trykker end battle så er den drepte uniten
> ikke lengre i hånda når jeg trykker reveal/discard. Alt burde resettes til
> originalt, også kan spilleren selv manuelt discarde unitene som er drept
> og skal fjernes fra spillet

Ending a battle should return a killed unit's card to hand exactly like any
other arena unit's — `inBattle` cleared, nothing more. The player discards it
themselves via the normal Discard button, same as the original issue-63
decision this had overridden.

A unit displaced by reinforcing a front (issue #74) does **not** get the same
treatment immediately — see the design note below.

## Why

Direct correction from the human after retesting. Not a new design — restores
the original issue-63 brief's "killed cards are NOT auto-discarded" decision,
which issue #71 had changed based on an earlier, differently-worded
complaint that turned out to mean something narrower (a unit reappearing
in hand **while the battle was still active**, not after it ends).

## Approach

- `discardKilledArenaUnit` (issue #71) is renamed `returnArenaUnitCardToHand`
  and stops touching `discardedItems` or writing a `DISCARD` log entry — it
  now does exactly what the "living unit" branch already did: clear
  `inBattle` on the source card (in `battlehand`/`items`, or `barbarians`)
  and nothing more.
- `endBattleAction` no longer branches on `arenaUnit.killed` — every arena
  unit's card is returned to hand the same way.
- Unchanged: `ArenaUnit.killed`, the kill/undo-kill toggle, the DEAD tag and
  dimming, and `battleSummaries` excluding killed units from totals. This
  was only ever about what happens to the card once it actually leaves the
  arena.

**Design note — reinforcement stays locked, not freed immediately.** Review
raised a real tension: freeing a reinforced-away unit's card right away
would let it become placeable again *while the battle is still running* —
the same "reappears mid-battle" shape as the original issue-68 bug that
issue #71 fixed. Asked directly, the human chose to keep it locked. `Battle`
gained `departedUnits: readonly ArenaUnit[]`; `placeUnitInArena` and
`moveArenaUnit`'s reinforcement branch move the displaced unit there instead
of calling `returnArenaUnitCardToHand` on it — its card stays `inBattle` for
the rest of the battle. `endBattleAction` iterates
`[...battle.arena, ...battle.departedUnits]`, so a reinforced-away unit's
card returns to hand at the same moment every other arena unit's does.
`migrate.ts` backfills `departedUnits: []` for battles saved before this
existed.

## Claimed paths

- `packages/engine/src/battle.ts`
- `packages/engine/src/actions/arena.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/test/arena.test.ts`
- `packages/server/test/api.test.ts`

## Acceptance criteria

- [ ] Ending a battle with a unit still `killed` returns its card to hand
      (`inBattle: false`), the same as an unkilled unit's — not discarded.
- [ ] Reinforcing a front held by a killed unit (issue #74) keeps that
      unit's card locked (`inBattle: true`) for the rest of the battle —
      not discarded, and not yet back in hand either.
- [ ] Ending the battle afterwards returns a reinforced-away unit's card to
      hand too, at the same time as everything else.
- [ ] No `DISCARD` log entry or `discardedItems` entry is produced by either
      path.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass — and
      note: `packages/server` consumes `@civ/engine` via its compiled
      `dist/`, so rebuild the engine (`pnpm --filter @civ/engine build`, or
      just run `pnpm -r typecheck` which triggers it) before trusting a
      server-only test run against fresh engine changes.
