# Issue #253: metropolis city footprint

- **Slug:** `issue-253-metropolis-footprint`
- **Branch:** `feat/issue-253-metropolis-footprint`
- **Owner:** Codex
- **Status:** in progress

## Goal

Include the full ten-square outskirts of a metropolis in derived city ownership and coin calculations, whether the two-square city marker is horizontal or vertical.

## Scope

- Treat a metropolis as two adjacent city-center squares along its visual long axis. Rotation 0/180 is horizontal; 90/270 is vertical.
- Include the union of the eight surrounding squares around those two centers (ten distinct outskirts squares) in the shared city footprint.
- Exclude both center squares from Bank and Great Person outskirts coins.
- Keep city ownership, placement provenance, blockade, and ambiguous adjacent-city behavior consistent with the existing shared helper.
- Add tests for both orientations and both equivalent rotations; prove an outermost metropolis square counts and unrelated/city-center squares do not.

## Out of scope

- Inferring scout-held coins or a newly built wonder from unstructured map movement.
- City placement validation, map snapping, or changing the board's rotation UI.

## Acceptance

- [ ] A Bank in an outermost metropolis outskirts square is credited horizontally and vertically.
- [ ] The 180° and 270° variants produce the same respective footprints as 0° and 90°.
- [ ] Neither of the two metropolis center squares is treated as an outskirts coin location.
- [ ] Existing city, blockade, Great Person and coin tests pass; no ownership is inferred from `placedBy` alone.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Read-only review approves; update issue #253 and project state.
