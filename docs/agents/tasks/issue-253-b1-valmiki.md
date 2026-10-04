# Issue #253 B1: suppress Valmiki while all artist tokens are blockaded

- **Slug:** `issue-253-b1-valmiki`
- **Branch:** `feat/issue-253-b1-valmiki`
- **Owner:** Codex
- **Status:** done (PR #258)

## Goal

Valmiki's revealed +2 culture hand-size bonus is active only while at least one of the player's tracked Artist or Thinker tokens is usable; it returns when a token is no longer blockaded.

## Why

The current derived hand-size calculation counts revealed Valmiki unconditionally, even though issue #241 already derives whether every tracked token of a Great Person type is blockaded. The human asked to continue B1 of issue #253.

## Scope

**In:**

- Suppress Valmiki's +2 when the player's tracked Artist or Thinker tokens exist and all are blockaded.
- Restore the bonus as soon as at least one tracked token is unblocked.
- Preserve #241's compatibility rule: if no Artist or Thinker token is tracked on the map, do not infer that Valmiki is disabled.
- Keep hidden Valmiki out of both owner and opponent derived totals.
- Add engine tests for blockade/unblock, no-token compatibility, and projections.

**Out:**

- Great Person inventory, reserve, acquisition or token lifecycle enforcement; issue #252 owns those rules.
- Other Great Person abilities or hand-size sources.

## Reference

Issue #253 B1 explicitly asks to reuse #241's `blockadedGreatPersonTypes` policy and keep hidden Valmiki from contributing. `packages/engine/src/culture-hand.ts` currently counts revealed Valmiki without checking blockade; `packages/engine/src/blockade.ts` already returns `Artist or Thinker` when tracked owned tokens are all blockaded and intentionally omits a type with no tracked token.

## Approach

Use the existing public-board helper in the derived culture-hand calculation. Add regression tests in `culture-hand-size.test.ts` that place owned Artist tokens and an enemy figure in the same map square, then verify the bonus disappears and returns when the enemy figure is removed. Preserve and test the no-token compatibility behavior and the owner/opponent projections.

## Claimed paths

- `README.md`
- `packages/engine/src/culture-hand.ts`
- `packages/engine/test/culture-hand-size.test.ts`
- `docs/agents/decisions.md`
- `docs/agents/tasks/issue-253-b1-valmiki.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [x] Revealed Valmiki gives +2 with no tracked Artist/Thinker token, preserving compatibility.
- [x] Revealed Valmiki gives no +2 when all tracked Artist/Thinker tokens are blockaded.
- [x] The bonus returns when at least one tracked token becomes unblocked.
- [x] Hidden Valmiki contributes nothing to the owner or opponent projection, regardless of blockade.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [x] Read-only review has no findings above a nit.

## Open questions

None. This follows the explicitly scoped issue text and existing blockade helper policy.
