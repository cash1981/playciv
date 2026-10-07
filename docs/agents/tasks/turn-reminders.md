# Daily reminders for idle turns

- **Slug:** `turn-reminders`
- **Branch:** `codex/turn-reminders`
- **Owner:** Codex
- **Status:** done

## Goal

Once a day, remind the player currently expected to act when the running game has had no action for more than 72 hours. Send one reminder per unchanged waiting state, with a link to the game.

## Why

The human requested a daily cron that detects three days without an action or state change and emails the waiting player.

## Scope

In: Cloudflare daily cron, durable idle tracking and duplicate prevention, current turnHolder semantics, mail preferences, both repositories and tests.
Out: UI, engine rules, deployment and sending development emails to real players.

## Reference

Current turnHolder/activeTurnStatus and existing transactional notifications. This is a new notification requested by the human.

## Approach

Add a separate 16:00 UTC reminder cron and preserve the existing 17:00 UTC broadcast cron, so their invocation budgets are independent. Keep idle and reminder data on the server, outside projections. Use persisted action timestamps when reliable, otherwise conservatively start tracking at first observation. Guard claims against concurrent cron runs and live state changes. Bound queries/provider work for Cloudflare. Preserve existing broadcast work and its separate error handling.

## Claimed paths

See the turn-reminders task-board claim.

## Acceptance criteria

- Only started, active games with a current holder are eligible; finished/lobby games never send.
- More than 72 hours without a game action/state change triggers one reminder to the current holder.
- State changes reset the wait; opening the game alone does not.
- Disabled/unsubscribed/no-address accounts are skipped. Missing mail configuration must not consume reminders.
- Reminders are independent of game-open notification holds, and include no private game information.
- Persistent duplicate prevention survives restart and overlapping cron runs.
- Tests cover boundaries, reset, eligibility, preferences, persistence and race guards on both stores.
- All workspace typechecks, tests and builds pass; independent read-only review approved.

## Open questions

None. Default to one reminder per unchanged waiting state to avoid daily duplicate mail.


## Verification and review

`pnpm -r typecheck && pnpm -r test && pnpm -r build` passed: 895 engine,
627 server and 528 web tests (2,050 total). Wrangler applied every migration,
including `0007`, to a fresh local D1 database; Worker deployment dry run passed.
No production deployment or real email sending was performed.

Sol read-only review approved round two with zero findings. Round one found
that a concurrent email-address change could send to a stale address; both
repositories now bind the expected address atomically and both-store sender
regression tests cover the race. Orchestrator approved the final implementation.


## CodeQL follow-up

PR #267 flagged the unanchored trailing-slash regex in appOrigin normalization
for polynomial runtime. Replace it with a backward character scan and one
slice, preserving the existing URL behavior with linear runtime. Re-run all
workspace checks, read-only review and the GitHub CodeQL check before completion.

The follow-up passed all workspace typechecks, 2,050 tests and builds. Sol
read-only review approved with zero findings. GitHub CodeQL is checked after
pushing the follow-up to the same PR.
