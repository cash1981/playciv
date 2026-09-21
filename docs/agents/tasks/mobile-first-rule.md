# Mobile-first frontend rule

- **Slug:** `mobile-first-rule`
- **Branch:** `chore/mobile-first-rule`
- **Owner:** Codex
- **Status:** claimed

## Goal

Make mobile-first design and usability a mandatory consideration for every
frontend implementation from now on. Mobile and tablet users are the primary
target; larger screens are enhancements rather than the baseline.

## Scope

- Add the rule to the repository's non-negotiable agent rules.
- Define concrete frontend checks in the coding conventions.
- Add mobile-first verification to the implementation workflow.
- Record the completed documentation change in the project state.

## Out

- No frontend code, layout, styling, or tests are changed by this task.
- No claim is made that existing screens have already been audited or fixed.

## Acceptance criteria

- [x] `AGENTS.md` contains a mandatory mobile-first rule for frontend work.
- [x] `docs/agents/conventions.md` defines practical mobile/tablet design,
      interaction, accessibility, and responsive verification expectations.
- [x] `docs/agents/workflow.md` requires the rule to be checked during
      implementation and verification.
- [x] `docs/agents/state.md` records the new project rule.
- [ ] Task claim is released after the documentation is complete and the review
      gate passes.

## Verification

- `git diff --check` — passed.
- `pnpm -r typecheck` — blocked by the existing engine test configuration not
  resolving Node globals/modules (`node:fs`, `node:url`, `URL`).
- `pnpm -r test` — passed: 429 engine, 173 server and 73 web tests.
- `pnpm -r build` — passed.
- Review gate — not started because the required typecheck did not pass.
