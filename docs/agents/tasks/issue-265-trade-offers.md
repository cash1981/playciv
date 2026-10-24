# Free-text trade offers in the game conversation

- **Slug:** `issue-265-trade-offers`
- **Branch:** `feat/issue-265-trade-offers`
- **Issue:** [#265](https://github.com/cash1981/playciv/issues/265)
- **Status:** in review

## Goal

Add explicit, free-text trade offers to the existing game conversation. An
offer names a recipient and terms, remains separate from ordinary chat, and
can be accepted, declined, withdrawn, or answered with a linked counteroffer.

## Boundaries

- Offers are records in `GameState`, projected with public author/recipient,
  terms, round/phase and status; no hidden hand or inventory data is inferred.
- Accepting records agreement only. It never mutates resources or interprets
  prose as an executable trade.
- Only game members can create offers; only the recipient accepts/declines or
  counters; only the sender withdraws. Spectators and replay are read-only.
- Every transition is a pure reducer and a public audit log entry. Request ids
  make retries idempotent and optimistic revisions reject stale writes.
- Pending offers are marked expired when a later round is observed; settled
  offers are never changed by expiry.

## Claimed paths

See the matching live claim in `docs/agents/task-board.md`. The implementation
is intentionally limited to engine state/reducer and its projections, the game
routes/API, and the conversation UI/tests. Issue #264 is not touched.

## Verification

Add engine, server and web tests for the lifecycle, permissions, stale and
duplicate requests, visibility, round expiry, draft preservation and mobile
text entry. Run `pnpm -r typecheck && pnpm -r test && pnpm -r build` and perform
an independent read-only review before handoff.
