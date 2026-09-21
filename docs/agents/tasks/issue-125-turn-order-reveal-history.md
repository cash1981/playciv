# Turn-order reveal history

- **Slug:** `issue-125-turn-order-reveal-history`
- **Branch:** `feat/issue-125-turn-order-reveal-history`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Status:** review-approved — PR to open, awaiting the human's merge

## Goal

Each of the five turn-order sections — start of turn, trade, city management,
movement and research — keeps a history of every version its owner has
*revealed*. Revealing a section stores the complete text of that section as an
immutable version with the reveal's timestamp. Earlier revealed versions stay
visible in the section (oldest first, greyed and struck through) above the
current editor, so a player who reveals, edits and reveals again can see what
was published before. Saving a draft never creates a version.

## Why

Issue #125: "When a player writes a movement or other turn-order entry, saves
it, reveals it, and then makes further changes before revealing again, there is
currently no way to see what was written in earlier reveals." The requested
behaviour, visual treatment and acceptance criteria are in the issue. Asked how
to treat the existing save-based `PlayerTurn.history`, the human chose
**replace**: the reveal history takes over that field.

## Scope

**In:**

- Change `PlayerTurn.history` per phase from a deduplicated list of saved order
  strings to an ordered list of revealed versions `{ markdown, at }`.
- Append a version only in `revealTurnOrder`, with a caller-supplied timestamp.
- Stop `withOrder` from touching the history.
- Render the versions in `TurnPanel` above each phase editor: oldest first,
  greyed, slightly opaque, struck through, each with its timestamp.
- Migration for saved games, plus engine, server and web tests.

**Out:**

- A diff view; the issue says each version is the complete content.
- One global turn history; the issue scopes the history to its own section.
- Editing, un-revealing or deleting a historical version.
- Changing the reveal button's save-before-reveal rules or the reveal log line.

## Reference

No old-system counterpart for the feature. The existing `PlayerTurn.history` is
a port of Java's per-phase `Set<String>`: `old-civ-rest`'s
`TurnAction.updatePrivatePlayerturn` adds every *saved* order to `sotHistory`
etc., and `getAllPublicTurns` removes the current order from it by mutating the
stored objects. It has no timestamps and `old-civ-web` never displayed it
(`TurnsController.js` is a stub with hardcoded turns). The human chose to
replace it, so the new shape is a documented product change, not a ported rule.

## Approach

`packages/engine/src/turn.ts`

- New `TurnOrderVersion { readonly markdown: string; readonly at: string }`.
- `PlayerTurn.history: Readonly<Record<TurnPhase, readonly TurnOrderVersion[]>>`.
- `withOrder` keeps setting `orders[phase]` and `revealed[phase] = false`, and
  no longer reads or writes `history`.
- `publicTurn` masks only `orders[phase]` for an unrevealed phase. A previously
  revealed version is public information and stays in `history`, even after the
  phase is edited and becomes private again.
- Remove `withoutCurrentOrderInHistory`; `allPublicTurns` becomes
  `Object.values(state.publicTurns).sort(compareTurns).map(publicTurn)`.
  It stripped the current order because the Java history contained it — the
  reveal history never does, so keeping it would hide the just-revealed version.
- `migratePlayerTurn` normalises `history`: keep entries already shaped
  `{ markdown: string, at: string }`, drop old string entries (save-based, and
  they included the current order, so they cannot be reinterpreted as revealed
  versions). Empty lists stay empty, so migration is idempotent.

`packages/engine/src/actions/turn.ts`

- `RevealTurnOrderInput` gains `at: string`. `revealTurnOrder` appends
  `{ markdown: turn.orders[input.phase], at: input.at }` to the phase's history
  and sets `revealed[phase] = true`. If the phase is already revealed it is a
  no-op, so a double request cannot append a duplicate version.

`packages/server/src/routes/play.ts`

- The reveal route passes `at: new Date().toISOString()`, the same convention as
  the board history (`routes/board.ts`).

`packages/web/src/views/TurnPanel.tsx` and `TurnPanel.css`

- `TurnOrderWorkspace` renders `current.history[phase]` oldest-first above the
  editor: a timeline `<ol className="turn-history">`, each entry showing
  `formatTimestamp(version.at)` and the complete Markdown text. CSS greys it,
  lowers the opacity and strikes the text through while keeping it readable. The
  current editor stays below, at normal contrast.

## Claimed paths

- `packages/engine/src/turn.ts`
- `packages/engine/src/actions/turn.ts`
- `packages/engine/test/turn-action.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/test/api.test.ts` (the reveal assertions only)
- `packages/web/src/views/TurnPanel.tsx`
- `packages/web/src/views/TurnPanel.css`
- `packages/web/src/views/TurnPanel.test.tsx`
- `docs/agents/tasks/issue-125-turn-order-reveal-history.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [x] Revealing a section creates exactly one new historical version.
- [x] Saving without revealing does not create a historical version.
- [x] Multiple reveals preserve every previously revealed version.
- [x] Versions are ordered oldest first and newest last.
- [x] Each version includes the timestamp of its reveal.
- [x] The complete revealed content is shown for every version; no diff view.
- [x] Historical entries are visibly de-emphasised (grey, slightly opaque,
      struck through) and the current editor is clearly below them.
- [x] History is maintained independently for each turn-order section.
- [x] Hidden information: an unrevealed phase's current text never reaches a
      public projection; a previously revealed version stays public after the
      phase is edited and made private again. Proven in `turn-action.test.ts`.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser with a real reveal, edit and second reveal.

## Open questions

None. The one material question — replace the save-based `history` versus add a
second field — was put to the human, who chose replace.

## Notes after implementation

- Verification (after rebasing onto `main` with the front-page join-button
  colours): `pnpm -r typecheck` exit 0; `pnpm -r test` engine 448, server 173,
  web 88; `pnpm -r build` exit 0.
- No browser was connected to the session, so the visual pass is the one
  unchecked box and is left to the human.
- The review gate (read-only `reviewer`) returned approve with nits. One minor
  finding: the history renders the raw Markdown source while the live editor is
  WYSIWYG, so styled text shows its syntax (`**bold**`). The orchestrator kept
  that on purpose — the brief specifies the complete Markdown text, the
  requested treatment is struck-through *text*, and `packages/web` has no
  Markdown renderer, so rendering it would mean a new client dependency and
  sanitizer. Worth a look during the human's browser pass. The second, a nit
  about a tautological timestamp assertion, was fixed.
- The `rules-checker` found no undocumented divergence from `old-civ-rest`/
  `old-civ-web`; the only change to old behaviour is the human-approved
  replacement of the save-based history.
- Follow-up, from the human's review of PR #126: every phase editor now has a
  fixed height with its own scrollbar (SOT, CM and MOVEMENT `10rem`; TRADE and
  RESEARCH `6rem`), and the revealed history is capped in its own scroll area
  (`10rem`/`6rem`). The per-phase hook is `data-turn-phase`. The first attempt
  only set `max-height`, which Milkdown's default `min-height: 8rem`/`6rem`
  overrode, so every box stayed ~8rem; the follow-up resets those min-heights.
  The private log is not a turn phase and keeps its default size. The history
  wraps long lines instead of scrolling horizontally — a deliberate choice
  (prose reads better wrapped and nothing is clipped); the editor still scrolls
  horizontally for a wide code line or URL. The follow-up's review left two nits
  on purpose: the jsdom test can only guard the `data-turn-phase` hook, not the
  CSS effect, and the two height variables always hold the same value. Both are
  the human's to accept in the browser.
