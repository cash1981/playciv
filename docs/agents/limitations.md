# Known limitations

Observations, not an authorized backlog. Recheck the cited code before acting.

## Game behavior

- **Legacy board layouts:** pre-shape three- and five-player saves that already
  hold pieces keep 16×16 rectangular slots; only an empty three-player board is
  moved into the pyramid. On the legacy five-player rectangle, player 5 shares
  player 1's starting corner. `engine/test/board.test.ts` pins this; reshaping
  would move existing pieces.
- **Legacy wonder hands:** older saves may keep wonder cards in `player.items`.
  Migration counts them for `wondersDealt` but does not move them to the board.
- **Legacy Egypt setup:** older saves backfill `wondersDealt` from
  `hasWonder || setupComplete`, so an Egypt revealed earlier never gets the
  three-ancient/one-medieval deal. Deliberately forward-only (`migrate.ts`).
- **Zulu starting units:** `actions/player.ts` deals four artillery; the
  printed/legacy rule may be three. Ask the human before changing it.
- **A square another scout sends:** the Start of Turn panel still offers the
  second scout's city choice; choosing a city is refused with a reason (#319).
- **Scout-held Bank coins:** board derivation does not model scout transfers;
  the Sheet is the manual correction.
- **Game-chat permissions:** `POST /api/games/:gameId/chat` checks login and
  game locking, not membership, so a non-member can post although the UI hides
  the composer. Whether that is intended is undecided.
- **Arena edits:** `runBattleAction` in `GameView.tsx` returns early while busy,
  so a debounced stat save can be dropped (found by inspection, not reproduced).
- **Revealed feed:** the history fetch is capped at 100 items; there is no full
  pagination.
- **Trade offer retries:** the chat panel keeps one request id per offer until a
  send succeeds. If the server stored an offer but the response was lost and the
  player never retried, sending the same words later returns the old outcome.

## Storage and delivery

- Archived Mongo `pbf` data is for historical statistics only.
- Manually deleting a middle revision delta is unsafe; use cleanup/compaction.
- Broadcast recipient claims and `lastRunAt` are separate writes in
  `notifications.ts` (a small release-stuck race). Never auto-retry an
  indeterminate send to work around it.
- Production deployment, D1 migration and scheduled-mail status must be checked
  in the target environment.

## Scope

- No tournaments or websockets; refresh polls.
- Bearer tokens cannot be revoked individually; disabled accounts are checked
  per request.
- Some card images exceed 1 MB.
- Asset regeneration needs untracked source material. Check that local Military
  Science artwork is the intended replacement before running the generator.
