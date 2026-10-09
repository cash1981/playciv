# Known limitations

Read the relevant section when working in that area. These are observations,
not an authorized backlog. Recheck the cited code/tests before acting. This
list was reconciled with main at `8eecce4` on 2026-10-09; no application fixes
were made as part of the documentation cleanup.

## Game behavior

- **Civilization reveal during setup:** a non-holder can receive
  `NOT_YOUR_TURN` when starting units are drawn. This is pinned by
  `packages/engine/test/player-action.test.ts` (the non-holder reveal test),
  not a newly inferred rules requirement.
- **Legacy board layouts:** pre-shape three-player saves already containing
  pieces and pre-shape five-player saves keep 16×16 rectangular slots. Only an
  empty pre-shape three-player board is rescued into the pyramid. On the legacy
  five-player rectangle, player 5 still shares player 1's starting corner.
  `packages/engine/test/board.test.ts` pins these intentional migration limits;
  reshaping would move existing pieces.
- **Legacy wonder hands:** older playable saves can retain wonder cards in
  `player.items`. Migration counts them when backfilling `wondersDealt`, but
  does not move them onto the board. Current draw/setup routes placing wonders
  on the board do not establish that every saved wonder is already there.
- **Legacy Egypt wonder setup:** older saves backfill `wondersDealt` from
  `hasWonder || setupComplete`. If Egypt was already revealed under the earlier
  behavior, the shared three-ancient/one-medieval deal is not added afterwards.
  This was deliberately forward-only; do not backfill it without an intentional
  compatibility change. See `packages/engine/src/migrate.ts`.
- **Zulu starting units:** `actions/player.ts` still deals four artillery;
  the historical decision records a discrepancy with the printed/legacy three.
  Consult the rulebook and human before changing it.
- **Scout-held Bank coins:** automatic board derivation does not model scout
  transfer bookkeeping; the Sheet remains the manual correction mechanism.
- **Spectator board controls:** in an active game, `GameView.tsx` passes
  replay/locked status to `BoardView` without the membership condition used by
  other panels. Some interactions can reach the API and be rejected. Server
  authorization remains required; a filtered view alone is not a UI lock.
- **Game-chat permissions:** `POST /api/games/:gameId/chat` in
  `packages/server/src/routes/games.ts` checks authentication and game locking
  but not membership. An authenticated non-member can post to an active game's
  chat even though the UI hides the composer. This cleanup records existing
  behavior, without deciding whether broader posting permission is intended.
- **Arena edits:** `GameView.tsx` returns early from `runBattleAction` while
  busy. A debounced stat save can be dropped while the local input retains its
  draft. This is a code-inspection risk from the previous decision log, not a
  newly reproduced browser failure.
- **Revealed feed:** the expanding history fetch is capped at 100 items;
  it is not complete pagination. Revision-list pagination/caching and broader
  real-device testing were also deferred, not silently completed.

## Storage and delivery

- Archived Mongo `pbf` data remains available for historical statistics, not
  playable converted games. Do not confuse it with classic current-format
  games adopted on load.
- Revision chains assume supported writes. Manually deleting a middle delta
  is unsafe; use the cleanup/compaction routines that preserve keyframes.
- Broadcast recipient claims and `lastRunAt` recording are separate operations
  in `notifications.ts`; the historical log notes a small release-stuck race.
  Indeterminate sends must not be automatically retried to work around it.
- Deployment, real D1 migration and scheduled-mail execution status are unknown
  until checked against the target environment. Past local tests are not proof
  of production rollout.

## Deliberate scope and validation limits

- Tournaments and websocket updates have no current implementation; refresh
  uses polling. Card artwork, admin game deletion and email already exist.
- Bearer tokens have no individual revocation mechanism. Disabled accounts are
  checked on requests; see README security notes.
- Some card images exceed 1 MB. Optimization is not currently queued.
- Asset regeneration requires untracked source material. In particular, ensure
  local Military Science artwork contains the intended replacement before
  running the generator; an older source can overwrite the committed image.
- A government-reference test previously timed out under parallel load. That
  historical report has not established a current reproducible failure.
