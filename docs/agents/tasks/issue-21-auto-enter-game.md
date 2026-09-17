# Join game opens the game

- **Slug:** `issue-21-auto-enter-game`
- **Branch:** `fix/issue-21-auto-enter-game`
- **Owner:** Codex/Luna (GPT-5.6-Luna)
- **Status:** in progress

## Goal

When a signed-in player clicks Join in the games list, the game opens
immediately after the join succeeds instead of leaving the player on the lobby.

## Why

Issue #21 says: “When pushing join, you should enter the game immediately.”

## Scope

**In:**

- Fix the client-side join success callback and add regression coverage where
  the existing test setup permits it.
- Update agent workflow documentation so every agent uses a dedicated worktree.

**Out:**

- Changes to game membership or engine rules; the server already joins the
  player successfully before the navigation occurs.

## Reference

This is a client bug introduced while adding browser game URLs. There is no
new Java game-rule behavior to port.

## Approach

Inspect the lobby action helper, ensure an explicitly supplied success callback
is invoked after the awaited join request, and retain the existing reload path
for actions without a callback. Keep navigation owned by `App` through the
existing `onOpenGame` callback.

## Claimed paths

- `packages/web/src/views/LobbyView.tsx`
- `packages/web/`
- `AGENTS.md`
- `docs/agents/workflow.md`
- `docs/agents/task-board.md`
- `docs/agents/tasks/issue-21-auto-enter-game.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] A successful Join request invokes `onOpenGame(game.id)` and opens the
  game URL immediately.
- [ ] Failed joins still show the error and do not navigate.
- [ ] Actions without a success callback still reload the game list.
- [ ] All agents are explicitly instructed to use dedicated worktrees.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] No hidden information or game-rule behavior is changed.
- [x] Browser behavior limitation is reported honestly: this checkout has no
  browser automation session or web test runner; typecheck/build passed and
  the callback flow was inspected directly. A browser smoke test should be
  run against the deployed app before release.

## Open questions

None.
