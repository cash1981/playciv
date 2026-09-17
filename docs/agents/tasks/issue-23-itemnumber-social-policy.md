# Issue #23 — Keep a social policy's item number when revealing it

- **Slug:** `issue-23-itemnumber-social-policy`
- **Branch:** `fix/issue-23-itemnumber-social-policy`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

When a player chooses a social policy, reveals it, and removes it, all three
log entries use the same per-player item number. If the player chooses the same
policy again after removal, that new choice receives a new per-player number.

## Why

Issue #23 reports that choosing Military Tradition logged item number #1194,
revealing it logged #362, and removing it logged #1194. The reveal must keep
the chosen card's number so the public log cannot suggest that a different card
was revealed.

## Scope

**In:**

- Make reveal log formatting use the social policy's unique item-number format.
- Allocate a fresh item number for each social-policy choice.
- Add engine regression coverage for choose → reveal → remove and choose again.

**Out:**

- Changing social-policy ownership or the policy-selection rules beyond the
  item-number allocation required by issue #23.
- UI changes; the issue concerns the engine log values.

## Reference

The issue's observed behaviour is in GitHub issue #23. The existing port uses
`createLogTexts` in `packages/engine/src/log.ts`; social policy choice and
removal already use `uniqueItemNumber`, while the generic reveal branch uses a
plain item number. The old system's `GameLog.uniqueItemNumber` is the reference
for hidden tech and social-policy logs.

## Approach

Extend the `REVEAL` log branch so social policies, like technologies, use the
player-specific `uniqueText` suffix. Add focused assertions in the social-policy
engine tests for matching numbers across reveal and removal, plus a fresh number
after choosing the policy again.

## Claimed paths

- `packages/engine/src/log.ts`
- `packages/engine/test/player-action.test.ts`
- `docs/agents/tasks/issue-23-itemnumber-social-policy.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] A social policy's choose, reveal, and remove log entries use the same
  per-player item number.
- [ ] Choosing the same policy after removal gives it a different item number.
- [ ] Existing tech reveal numbering remains unchanged.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: the revealed policy name is only in the reveal log as
  before; no additional card information is exposed by the number fix.
- [ ] Browser verification: not applicable; this is an engine log-format fix.

## Open questions

None.
