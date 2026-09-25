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

- Correct the `Military Tradition` row's flipside value in
  `packages/engine/data/gamedata-faf-waw.json` from `Patronage` to `Pacifism`,
  so the pair is symmetric like the other three (`Rationalism` ↔ `Patronage`,
  `Natural Religion` ↔ `Organized Religion`, `Expansionsim` ↔
  `Urban Development`).
- Update `SocialPolicyPanel.test.tsx`'s `CATALOGUE` fixture and the test that
  asserted the old one-way behaviour, so it now proves the pair is symmetric.
- Record the correction in `docs/agents/decisions.md`, since it reverses the
  2026-09-22 decision that read this asymmetry as intentional.

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

- Edit the two affected cells in `gamedata-faf-waw.json` directly (the file
  is committed and is what the engine actually reads at runtime; the source
  `.xlsx` lives in the gitignored `old-civ-rest` reference copy and isn't
  shared, so fixing only there would not reach anyone else's checkout).
- No engine code changes: `PlayerAction.chooseSocialPolicy`'s TS port and
  `policyUnavailableReason` in `SocialPolicyPanel.tsx` already do the right
  check; they were just fed a bad value for one row.
- Update the `SocialPolicyPanel.test.tsx` fixture and its directional test to
  match.

## Claimed paths

- `packages/engine/data/gamedata-faf-waw.json` (shared resource — claiming it)
- `packages/web/src/views/SocialPolicyPanel.test.tsx`
- `docs/agents/decisions.md` (append only)

## Acceptance criteria

- [ ] `Military Tradition`'s flipside in `gamedata-faf-waw.json` is `Pacifism`
- [ ] `Pacifism`'s flipside is still `Military Tradition` (unchanged)
- [ ] Picker: choosing `Pacifism` greys out `Military Tradition`, and vice versa
- [ ] `SocialPolicyPanel.test.tsx` reflects the symmetric pair, no test asserts
      the old one-way behaviour
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: n/a — no projection or hand data touched
- [ ] Verified in the browser: choose `Pacifism` for the signed-in player, and
      confirm `Military Tradition` is greyed out with a "flipside of Pacifism"
      reason in the picker

## Open questions

None — the fix is narrow and the human filed the issue describing the exact
symptom to correct.
