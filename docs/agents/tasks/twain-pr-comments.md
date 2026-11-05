# Fix applicable PR #336 comments

Base: `46e1450b` on `feat/great-person-twain`. Preserve the existing implementation
and local work; publish reviewed fixes to the same PR branch without force.

## Confirmed findings

1. Review comment 4478971507: `preserveWriting` currently reopens earlier turns
   when their orders change after a later cancellation target. On cancelling a
   turn-2 action, edited turn-1 Research text must be retained without reopening
   turn 1 or rolling `turnStatus` behind the restored board/resources. Preserve
   baseline completion/revision flags for turns before the rollback turn; keep
   the current same-turn reopening behavior. Test actual cross-turn progression,
   retained older text/history, correct current turn, and restored board/stats.
2. Comment 4478971592: an admin who participates in an ended game can open a
   case that other participants cannot pass. Reject new case opening in the
   engine when `state.active` is false, with an explicit error and no mutation.
   Test both the pure engine and real API with an admin holder. Preserve normal
   replay/idempotence of requests already committed; do not alter general admin
   ended-game correction privileges.
3. Comment 4478971665: every Twain target contains the full remaining public
   log, causing quadratic serialized data now that the cancellation floor
   persists across turns. Remove obsolete suffix arrays from target projections
   and directly dependent types/UI/tests. The durable case still retains one
   affected-history preview. Keep target labels/blocking reasons and existing
   stale-target safety. Test multiple targets and growing history to ensure no
   suffix text is copied per target; do not add an arbitrary target cap.
4. Comment 4478971735: `context.ts` creates exact before-action gap checkpoints
   with `createGameRevision(undefined, game, ...)`, repeating every old log ID
   and public/private description. Use the same state as before and after to
   backfill the snapshot with only its fallback metadata. Test a note-only gap,
   empty `logIds`/private descriptions and no pre-target content in affected
   cancellation preview. Keep the exact baseline and note privacy intact.

Older comments 4466025483 and 4466025578 already have current guards/tests.
Retain those protections; do not reimplement or weaken them.

## Delivery

Use a dedicated worktree. Keep changes surgical; no Writing/Mass Media feature
work, unrelated refactors or altered printed rules. Update relevant decisions
with the earlier-turn completion invariant. Add focused regression tests that
fail before fixes, and run full root verification:
`pnpm -r typecheck && pnpm -r test && pnpm -r build`.
Independent read-only review must approve after any fixes. Release the claim
and remove this brief on completion. Push to the existing PR branch and reply
to the four applicable review threads with the fixes and verification.
