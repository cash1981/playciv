# Military Tradition should be disabled when Pacifism is held

- **Slug:** `issue-175-pacifism-military-tradition-flipside`
- **Branch:** `feat/issue-175-pacifism-military-tradition-flipside`
- **Owner:** Claude
- **Status:** draft

## Goal

Once a player has chosen the `Pacifism` social policy, `Military Tradition`
must be greyed out in the picker (and refused by the engine), the same way
every other flipside pair already blocks its partner.

## Why

Issue #175 (screenshot attached): with `Pacifism` chosen, `Military Tradition`
is still selectable. It should not be — the two are opposite sides of the same
physical card.

## Scope

**In:**

- Correct `Military Tradition`'s flipside from `Patronage` to `Pacifism` at
  parse time in `packages/engine/src/gamedata.ts` (not by hand-editing the
  generated JSON — see Approach), so the pair is symmetric like the other
  three (`Rationalism` ↔ `Patronage`, `Natural Religion` ↔
  `Organized Religion`, `Expansionsim` ↔ `Urban Development`).
- Migrate existing saved games in `packages/engine/src/migrate.ts`: a game
  created before this fix froze the old value into its own `socialPolicies`
  catalogue and into any player's already-chosen copy, so those need the same
  correction on read.
- Update `SocialPolicyPanel.test.tsx`'s `CATALOGUE` fixture and the test that
  asserted the old one-way behaviour, so it now proves the pair is symmetric.
- Add a `gamedata.test.ts` test over the real parsed catalogue asserting all
  eight cards pair up symmetrically, so a regression here fails a test that
  isn't just a hand-written fixture.
- Record the correction in `docs/agents/decisions.md`, since it reverses the
  2026-09-22 decision that read this asymmetry as intentional, plus a short
  note in `README.md`'s "Known differences from Java" and a correction to a
  now-stale claim in `docs/agents/state.md`'s issue #101 entry.

**Out:**

- No other social policy pair — the other three are already symmetric.
- No change to `chooseSocialPolicy` or `policyUnavailableReason`: both already
  implement "block a candidate whose own flipside is held"; the bug is in the
  data, not the check.

## Reference

`packages/engine/src/gamedata.ts` parses the `Social Policy` sheet
(`Name`/`Description`/`Flipside` columns) from
`packages/engine/data/gamedata-faf-waw.json`, which is generated from
`old-civ-rest/src/main/resources/assets/gamedata-faf-waw.xlsx` by
`tools/xlsx-to-json.ps1` (`pnpm --filter @civ/engine gamedata`).

Confirmed the xlsx itself already has the bad value (`Military Tradition` →
`Patronage`) — re-running the generator against the local reference copy
reproduces byte-for-byte the same `Social Policy` rows as what is committed.
So this is a data-entry error in the old system's own spreadsheet, not a
porting bug: 7 of the 8 rows pair up symmetrically, this one does not, and the
physical FFG card has `Military Tradition` printed on the back of `Pacifism`
(and vice versa) — same as the other three pairs are two sides of one card.
Per the human's report on #175, correcting it rather than reproducing the old
system's typo verbatim.

The 2026-09-22 entry in `decisions.md` ("The social policy picker greys out
exactly what the engine rejects") explicitly called this asymmetry intentional
and warned a future reader not to "fix" it into symmetry. That reasoning
mistook a data typo for a deliberate one-way design; this task corrects both
the data and that entry's conclusion.

## Approach

- Leave `gamedata-faf-waw.json` exactly as `pnpm gamedata` produces it — its
  own header says not to hand-edit it, and re-running the generator against
  the (still-typo'd) source spreadsheet would silently revert a hand edit.
  Correct the value where the sheet is parsed into typed items instead
  (`gamedata.ts`), so it survives regeneration.
- Add a migration in `migrate.ts` (same pattern as its other backfills) so a
  game saved before this fix — including whatever game issue #175 was filed
  from — is corrected on read, not only a freshly created one.
- No other engine code changes: `chooseSocialPolicy`'s TS port and
  `policyUnavailableReason` in `SocialPolicyPanel.tsx` already do the right
  check; they were just fed a bad value for one row.
- Update the `SocialPolicyPanel.test.tsx` fixture and its directional tests to
  match, and add a `gamedata.test.ts` test over the real parsed data.

## Claimed paths

- `packages/engine/src/gamedata.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/test/gamedata.test.ts`
- `packages/engine/test/migrate-social-policy.test.ts` (new)
- `packages/web/src/views/SocialPolicyPanel.tsx` (comment only)
- `packages/web/src/views/SocialPolicyPanel.test.tsx`
- `docs/agents/decisions.md` (append only)
- `docs/agents/state.md`
- `README.md`

## Acceptance criteria

- [ ] `game.socialPolicies` (the real parsed catalogue) has `Military
      Tradition` → `Pacifism` and `Pacifism` → `Military Tradition`
      (unchanged)
- [ ] A game saved with the old `Patronage` value is corrected by
      `migrateGameState`, both the catalogue and an already-chosen card
- [ ] Picker: choosing `Pacifism` greys out `Military Tradition`, and vice versa
- [ ] `SocialPolicyPanel.test.tsx` reflects the symmetric pair, no test asserts
      the old one-way behaviour
- [ ] `gamedata.test.ts` fails if a future edit reintroduces an asymmetric pair
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: n/a — no projection or hand data touched
- [ ] Verified in the browser: choose `Pacifism` for the signed-in player, and
      confirm `Military Tradition` is greyed out with a "flipside of Pacifism"
      reason in the picker

## Open questions

None — the fix is narrow and the human filed the issue describing the exact
symptom to correct. The review gate additionally found: existing saved games
weren't covered (addressed with the migration above), and hand-editing the
generated JSON was unguarded against regeneration (addressed by moving the
fix into `gamedata.ts`).
