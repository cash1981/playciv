# Draw before chat and log

- **Slug:** `draw-before-chat-log`
- **Branch:** `feat/draw-before-chat-log`
- **Owner:** Codex
- **Status:** done

## Goal

After the board, the Draw panel is the first game panel a player sees. Chat and
Log remain grouped immediately below it, with every later panel keeping its
current order.

## Why

The human asked: "kan du flytte draw some det første panelet som vises over
chat og log?" Drawing is the first action they want surfaced after the board.

## Scope

**In:**

- Move the existing Draw panel above the Chat/Log pair in the game view.
- Add a regression test that pins this panel order.

**Out:**

- Changes to draw rules, APIs, or panel open/closed defaults; the request is
  only about presentation order.
- Changes to the Chat/Log responsive pairing or the order of later panels.

## Reference

This is a new presentation preference requested by the human. It does not
change or reproduce a rule from `old-civ-rest` or `old-civ-web`.

## Approach

Reorder the existing `DrawPanel` element in `GameView.tsx`, update the nearby
layout comment, and cover the resulting DOM order in `GameView.test.tsx`.

## Claimed paths

- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/GameView.test.tsx`
- `docs/agents/tasks/draw-before-chat-log.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] Draw is rendered immediately after the board and before both Log and Chat.
- [ ] Log and Chat retain their existing responsive pair layout.
- [ ] Every panel after the Chat/Log pair retains its existing order.
- [ ] A web test fails if Draw is moved below Log or Chat again.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: no state or projection changes are made, so no new
  leak test is required.
- [ ] Verified in the browser: Draw appears above Chat and Log after the board.

## Open questions

None.
