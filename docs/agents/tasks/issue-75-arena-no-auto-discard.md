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

Ending a battle (or reinforcing a fallen unit's front, issue #74) should
return a killed unit's card to hand exactly like any other arena unit's —
`inBattle` cleared, nothing more. The player discards it themselves via the
normal Discard button, same as the original issue-63 decision this had
overridden.

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
- The issue-74 reinforcement path (`placeUnitInArena`, `moveArenaUnit`)
  calls the same renamed helper, so a unit displaced by reinforcement also
  returns to hand rather than being discarded.
- Unchanged: `ArenaUnit.killed`, the kill/undo-kill toggle, the DEAD tag and
  dimming, and `battleSummaries` excluding killed units from totals. This
  was only ever about what happens to the card once it actually leaves the
  arena.

## Claimed paths

- `packages/engine/src/actions/arena.ts`
- `packages/engine/test/arena.test.ts`
- `packages/server/test/api.test.ts`

## Acceptance criteria

- [ ] Ending a battle with a unit still `killed` returns its card to hand
      (`inBattle: false`), the same as an unkilled unit's — not discarded.
- [ ] Reinforcing a front held by a killed unit (issue #74) also returns
      that unit's card to hand, not discards it.
- [ ] No `DISCARD` log entry or `discardedItems` entry is produced by either
      path.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass — and
      note: `packages/server` consumes `@civ/engine` via its compiled
      `dist/`, so rebuild the engine (`pnpm --filter @civ/engine build`, or
      just run `pnpm -r typecheck` which triggers it) before trusting a
      server-only test run against fresh engine changes.
