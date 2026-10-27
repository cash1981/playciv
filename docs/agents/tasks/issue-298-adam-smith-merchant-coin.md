# Adam Smith Merchant coin

- **Slug:** `issue-298-adam-smith-merchant-coin`
- **Branch:** `fix/issue-298`
- **Owner:** Copilot
- **Status:** in progress

## Goal

When Adam Smith is revealed and usable, the Coins panel shows both his
Merchant-icon coin under Great People and his separate +1 ability coin.

## Why

Issue #298 reports that Great People coins omit the Merchant icon when the
Merchant Great Person is Adam Smith, despite his separate Adam Smith coin being
shown.

## Scope

**In:**

- Include Adam Smith's revealed, usable Merchant icon in the derived Great
  People coin count.
- Add an engine regression test showing it alongside the distinct Adam Smith
  ability coin.

**Out:**

- Browser verification and unrelated Great Person coin behavior; the requested
  verification is an engine unit test.

## Reference

`packages/engine/src/coins.ts` derives Adam Smith's ability coin separately
from Great Person marker coins. The current coin decision states that Adam
Smith effects derive from revealed cards. Issue #298 and the reporter's
reproduction require the revealed Merchant icon to contribute its own coin as
well.

## Approach

Use the existing public/revealed and blockade eligibility for Adam Smith, and
include its Merchant-icon coin in the derived Great People row. Cover the
combined sources with a unit test.

## Claimed paths

- `packages/engine/src/coins.ts`
- `packages/engine/test/coin-sources.test.ts`
- `docs/agents/task-board.md`
- `docs/agents/tasks/issue-298-adam-smith-merchant-coin.md`

## Acceptance criteria

- [ ] A revealed, usable Adam Smith contributes 1 coin to Great People in
  addition to the 1 coin in the Adam Smith row.
- [ ] Hidden or unusable Adam Smith does not add the Merchant-icon coin.
- [ ] The focused engine unit test passes.
- [ ] No browser test is needed; no UI rendering changes are in scope.

## Open questions

None.

## Handover

Record actual validation and remaining limits before handing the branch to
review.
