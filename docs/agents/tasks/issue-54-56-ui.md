# Chat timestamps and board heading

- **Slug:** `issue-54-56-ui`
- **Branch:** `fix/issue-54-56-ui`
- **Owner:** Codex
- **Status:** approved

## Goal

Every game and lobby chat message shows its creation time in the same local
`dd.MM.yyyy HH:mm:ss` format as the game log. The board header says only
"Civilization Boardgame" instead of reporting board dimensions and piece count.

## Why

GitHub issue #54 asks: "All chats should have timestamp. Use same time format
as the Log." Issue #56 asks to replace "Board 16 × 8 squares · 11 pieces" with
"Civilization Boardgame" and remove the associated counting code when unused.

## Scope

**In:**

- Add one shared timestamp formatter for web views.
- Show timestamps in game chat and lobby chat.
- Replace the dynamic board summary with the requested static heading.
- Add focused web tests for timestamp formatting.

**Out:**

- Server and persistence changes, because chat DTOs already include `createdAt`.
- Changes to chat ordering or retention.
- Other board behaviour and layout.

## Reference

These are new presentation changes requested in issues #54 and #56. Existing
log formatting in `packages/web/src/views/LogPanel.tsx` is the direct reference
for the timestamp format.

## Approach

Move the existing log timestamp formatter into a web utility, use it for log
and both chat views, and render timestamps with semantic `<time>` elements.
Replace the two-part board header with one `h2`; the derived `pieces` value is
still needed throughout the board, so only its header count usage is removed.

## Claimed paths

- `packages/web/src/lib/formatTimestamp.ts` (new)
- `packages/web/src/lib/formatTimestamp.test.ts` (new)
- `packages/web/src/views/LogPanel.tsx`
- `packages/web/src/views/LandingView.tsx`
- `packages/web/src/views/BoardView.tsx` (header line only)

## Acceptance criteria

- [ ] Game chat displays each valid `createdAt` timestamp as `dd.MM.yyyy HH:mm:ss`.
- [ ] Lobby chat displays each valid `createdAt` timestamp in the same format.
- [ ] Invalid timestamps are omitted rather than displaying an invalid date.
- [ ] The board header reads exactly "Civilization Boardgame" and no longer displays dimensions or piece count.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: no projections or data payloads change.
- [ ] Verified in the browser: game chat, lobby chat and board heading are visually checked.

## Open questions

None.
