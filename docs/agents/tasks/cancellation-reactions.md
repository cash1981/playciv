# Reversible cancellation reactions (#301, #336)

## Goal

Replace immediate Mark Twain rollback with a persistent, privacy-safe reaction
window. Normal play may proceed across phases and players until someone actually
cancels. Preserve local work and publish to `feat/great-person-twain` without a
force push. The human will test and merge.

## Agreed scope and behavior

- The first version pauses shared gameplay only during an actual dispute.
  Chat, private notes and order writing remain available. No speculative draws,
  automatic command replay or arbitrary merging of state deltas.
- Target explicit assisted actions by stable ID/log ID, with a server-validated
  before-action revision. Keep references to original continuation and baseline
  revisions server-side; never put raw snapshots or hidden records in views.
- Support Mark Twain against eligible city actions/culture events and culture
  cancellation cards (Jousting Tourney, Primetime TV, Bread and Circuses) against
  the targets their printed text permits. Counter-cancellations target a specific
  culture cancellation event, never a Great Person. Do not infer Bread and
  Circuses applicability to a counter unless the actual targeting supports it.
  Resource abilities without a structured record stay explicitly manual.
- A cancellation opens a durable case without changing the target's game
  effects or reshuffling. All active players, regardless of hands, see the same
  public response/pass opportunity. Each new response invalidates prior passes.
  Resolve only when everyone passes the current case version. No automatic
  passing or timeout based on hidden hands.
- Dr. King may be revealed by the target city action's owner as protection.
  It is not a counter to Twain. User explicitly decided: **keep Twain in hand**
  when Dr. King prevents cancellation. The reveal remains public and in effect.
  A reaction card/protection must have been available at the historical target
  action, not obtained by a later action that cancellation would invalidate;
  validate ownership in both the saved baseline and live state, including reward
  candidates and blockade rules.
- If cancellation fails, the original continuation/draws remain unchanged,
  with valid reaction costs and reveals preserved. If cancellation succeeds,
  restore the before-action state once, apply target/reaction costs once,
  reshuffle affected decks once, and retain subsequent actions as superseded
  history with their public descriptions. Preserve current notes and order
  text/history, but reopen affected phases and flag orders as needing revision.
  This includes interleaved players' work. Never silently delete their orders.
- New cancellations may span phases. Use an explicit shared confirmation
  frontier rather than phase completion: players acknowledge a specific history
  cutoff; only the minimum acknowledgement of all active players seals it.
  Newly posted actions are not covered by older acknowledgements. Start the
  feature's eligible history at the current turn on adoption; persist this floor
  so unconfirmed history remains available over later turn boundaries. Expose
  the frontier/confirmation in the UI. Do not change ordinary turn progression
  or require confirmation after every action. No confirmation past an open case.
  Ordinary cancellation cannot cross the sealed frontier; older corrections
  remain manual/table-agreed. Document this asynchronous-play convention.
- Persist case IDs, versions, reaction targets, participants/passes and resolution
  outcomes. Use optimistic revision checks and idempotent request IDs, including
  retries of opening, responding and final passing. A resolved reaction case must
  not be erased/refunded by a later rewind. Prefer a conservative explicit
  boundary at a resolved case over trying to merge multiple overlapping cases.
- Keep engine reducers pure, validate on the server, and close mutation bypasses
  during disputes (not merely disable UI buttons). Spectators are read-only.

## Implementation guidance

Reuse keyframe/delta revision storage and existing card/UI patterns. Add a small
dedicated cancellation module/panel instead of expanding Twain-only abstractions
everywhere. Preserve the `/twain` compatibility route, but make it open a case.
The public panel explains the target, affected later actions, response chain and
who still needs to pass; only the viewer's own response card choices are private.
Clearly explain that orders remain drafts while gameplay is paused.

Current origin PR checks only an open phase and refuses other-player revisions;
local changes already relax the phase restriction and display blocked targets.
Keep those improvements and replace superseded assumptions/tests intentionally.
Read card texts in `packages/engine/data/gamedata-faf-waw.json`; local rulebooks
are unavailable. Do not invent additional rules.

## Required evidence

Focused engine/API/UI tests must cover: cross-phase/interleaved rollback;
no state/deck change before settlement; culture counter and counter-counter;
Twain cannot be countered as a culture event; King reveal preserves original
continuation and Twain; costs/reveals survive resolution exactly once; historical
card eligibility; missing revision fails atomically; stale passes/requests;
shared frontier and no implicit confirmation of later actions; legacy migration;
notes/orders preserved with reopened phases; no raw snapshot/hand/private-log
leaks to opponents or spectators; mutation-route guards and persistence/reload.

Run `pnpm -r typecheck && pnpm -r test && pnpm -r build` from the worktree root.
There was a server test failure on pristine origin in
`d1-repository.test.ts:328` expecting Alice/Bob order; investigate only if it
recurs, and do not weaken unrelated tests. Browser-check if available.
Update relevant decisions/limitations and README with behavior and limits.
Independent read-only review is required; fix and repeat until clear.
