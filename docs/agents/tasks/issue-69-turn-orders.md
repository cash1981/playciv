# Turn order improvements

- **Slug:** `issue-69-turn-orders`
- **Branch:** `feat/issue-69-turn-orders`
- **Owner:** Codex (GPT-5)
- **Status:** approved

## Goal

Turn orders are organized by player tabs so everyone can inspect one player's
published orders at a time, while only the signed-in player's tab is editable.
Each phase uses a friendly WYSIWYG Markdown editor. A final **Private log** tab
gives the signed-in player an unlogged, unpublished place for plans and notes.

## Why

Issue #69 asks for the turn-order layout shown in its annotated mockup. The
owner clarified that the labels in the mockup mean one tab per username, that
the existing "All orders" list should be replaced by those tabs, and that a
private planning tab is needed so future intentions are not published early.

## Scope

**In:**

- One color-accented tab per player, labelled with the username.
- The signed-in player's tab is editable; every other player tab is read-only.
- The turn selector applies to the selected player; New turn and lock/reopen
  remain available only on the signed-in player's tab.
- Replace the five plain textareas with Milkdown Crepe WYSIWYG Markdown editors.
- A final **Private log** tab backed by the existing private `gamenote` and
  `saveNote` action, with explicit save and no public log entry.
- Remove the redundant "All orders" section.
- Verify that locking and reopening remain publicly logged.

**Out:**

- Global Back / Forward / Live state replay and revision storage. These are
  tracked separately in GitHub issue #70.
- Private drafts attached to later turn numbers. For now future planning belongs
  in Private log; publishing draft turns needs a separate explicit publish model.
- Chat and lobby chat.
- Changes to the existing board-only replay controls.

## Reference

- GitHub issue #69 and its annotated mockup are the UI reference.
- `old-civ-web/app/views/nav.html` provided "Personal and hidden game notes" as
  a private modal; the new tab keeps that behavior but makes it easier to reach.
- `old-civ-rest/.../PlayerAction.java` stores notes on `Playerhand.gamenote`
  without adding a game log entry.
- Existing TypeScript behavior in `packages/engine/src/actions/turn.ts` remains
  authoritative for publishing and locking turn orders.

## Approach

Keep the change within the web client. `TurnPanel` loads the current
`PlayerView` together with public turns so it can build username/color tabs and
read the signed-in player's private note. Existing `updateTurn`, `lockTurn` and
`saveNote` endpoints remain unchanged. A reusable editor wrapper integrates
Milkdown Crepe and emits Markdown while supporting read-only mode. Component
styles live in a new turn-panel stylesheet so the in-flight shared stylesheet
claim is not touched.

## Claimed paths

- `docs/agents/tasks/issue-69-turn-orders.md`
- `packages/web/package.json`
- `pnpm-lock.yaml`
- `packages/web/src/views/TurnPanel.tsx`
- `packages/web/src/views/TurnPanel.css` (new)
- `packages/web/src/views/MarkdownEditor.tsx` (new)
- `packages/web/src/views/TurnPanel.test.tsx` (new)

## Acceptance criteria

- [x] Every current player has one tab labelled with their username and accented
      with their player color when available.
- [x] Selecting a player and turn shows that player's published five-phase
      orders.
- [x] Only the signed-in player's selected turn can be edited, saved, locked or
      reopened; other player tabs are read-only.
- [x] All five phases use a WYSIWYG editor whose stored value remains Markdown.
- [x] Private log loads and saves only the signed-in player's `gamenote`, and
      saving it creates no game-log entry.
- [x] The old "All orders" list is removed.
- [x] Lock and reopen behavior remains logged and covered by the existing engine
      tests.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: another player's private log is never present in the
      client projection; existing projection coverage remains passing.
- [x] Verified in the browser: player tabs, read-only opponent view, editable own
      orders, Markdown formatting, private-log persistence and responsive layout.

## Open questions

None. The owner explicitly deferred private future-turn drafts and global replay.
