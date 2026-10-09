# Remove the "Move old games to the single chat" admin tool

- **Slug:** `remove-migrate-chat`
- **Branch:** `chore/remove-migrate-chat`
- **Owner:** Claude (Sonnet 5.5)
- **Status:** in progress

## Goal

The human has finished moving every game to the single chat. Remove the admin
panel for it and all code that only existed to serve it.

## Decisions from the human (2026-10-09)

- Scope: panel, API and helper code. The stored flags `legacyOrdersCopied` and
  `legacyRevealsCopied` stay in `GameState`, `create-game.ts` and `migrate.ts`,
  so old saved games load exactly as before. Do not touch them.
- Load-time adoption of classic games (`migrate.ts`, `migrate-chat.test.ts`)
  stays; it is not part of the admin tool.

## Remove

- Web: `MigrateChatPanel` and its constants in `views/AdminView.tsx` (and its
  mount), `migrateChatPreview` / `migrateChat` and the `MigrateChat*Dto` types
  in `lib/api.ts`, the matching tests in `AdminView.test.tsx` and `api.test.ts`.
- Server: `GET`/`POST /api/admin/games/migrate-chat` and the helpers only they
  use in `routes/admin.ts` (`MIGRATE_CALLS_PER_REQUEST`, `hasVersionlessOrders`,
  `needsRevealCopy`, unused imports), `src/legacy-orders.ts`,
  `test/chat-orders-legacy.test.ts`, and `test/saved-orders.ts` if nothing else
  imports it.
- Engine: the functions in `src/turn.ts` that only the route used
  (`publicOrderVersions`, `publicOrdersWithoutVersions`, `unpublishedDrafts`,
  `pendingDrafts`, `draftsToPrivateNote`, their types and index exports) and
  their tests in `test/chat-orders-legacy.test.ts` (and `test/saved-orders.ts`
  if unused). Check each with grep before deleting; keep anything still used by
  something else.
- `test/revision-delta-api.test.ts` uses the route as its "admin write without
  a revision" (around line 255-280). Replace it with another real unrecorded
  admin write or the renamed-game stand-in the same file already uses; keep
  what the test proves (no revision added, newest sealed, next revision is a
  keyframe).
- Comments in `engine/src/state.ts` that point at the removed route: reword to
  say the flags are kept only so old saves load; do not change the types.

## Docs (orchestrator does these)

`decisions.md` entry, `state.md` line, README if it mentions the panel.

## Claimed paths

- `packages/web/src/views/AdminView.tsx`, `AdminView.test.tsx`
- `packages/web/src/lib/api.ts`, `api.test.ts`
- `packages/server/src/routes/admin.ts`, `src/legacy-orders.ts`
- `packages/server/test/chat-orders-legacy.test.ts`, `saved-orders.ts`, `revision-delta-api.test.ts`
- `packages/engine/src/turn.ts`, `index.ts`, `state.ts` (comments only)
- `packages/engine/test/chat-orders-legacy.test.ts`, `saved-orders.ts`
- `docs/agents/*`, `README.md`

## Acceptance criteria

- [ ] The admin page no longer shows the panel; both routes are gone (404).
- [ ] `grep -rn "migrate-chat\|migrateChat\|legacy-orders\|copyLegacyOrders" packages` finds nothing.
- [ ] An old saved game still loads (existing `migrate-chat.test.ts` passes).
- [ ] The other admin panels (cleanup, compaction, etc.) and their tests are unchanged.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
