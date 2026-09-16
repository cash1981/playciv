---
name: feature
description: Start, resume or finish a feature — branch, task claim, brief and pull request. Use when the human names a feature to work on, asks to pick up the next queued task, or says a feature is done. Handles the bookkeeping in docs/agents/ so the task board and state file never go stale.
---

# Feature

Manages the lifecycle of one feature: the branch, the claim on the task board,
the brief, and the pull request. The process it follows is
`docs/agents/workflow.md`; this is the automation of it.

Argument: a slug (`tech-tree`), or one of `next`, `status`, `finish`.

## Start

Given a slug, or `next` to take the top of the queue in
`docs/agents/task-board.md`.

1. **Check the board.** Read `docs/agents/task-board.md`. If the slug already
   has a live claim owned by someone else, stop and say so — do not take it.
2. **Check the brief.** `docs/agents/tasks/<slug>.md` should exist. If it does
   not, write one from `docs/agents/templates/task-brief.md` and show it to the
   human before starting work. A brief is what the reviewer checks against;
   without one a review can only check style.
3. **Read the brief's open questions.** If any would materially change the
   work, ask the human now rather than guessing.
4. **Branch.**

   ```bash
   git checkout main && git pull && git checkout -b feat/<slug>
   ```

   If the branch exists already, check it out and rebase on `main`.
5. **Claim it.** Add a block to "Live claims" in the task board with the owner,
   branch, brief, status `in progress`, and the paths from the brief. Commit
   that on its own so the claim is visible immediately.
6. Check the "Shared resources" table. If the brief touches one, set its owner
   there too.

Then do the work — directly, or by spawning the `coder` agent with the brief.

## Status

Read `docs/agents/task-board.md` and `docs/agents/state.md` and report: what is
claimed, by whom, what is queued, and whether the working tree is clean and on
a feature branch. Nothing else; this is a cheap orientation command.

## Finish

Only after `/review-gate` has been approved. If it has not, say so and stop.

1. **Verify once more**, and report the real output:

   ```bash
   pnpm -r typecheck && pnpm -r test && pnpm -r build
   ```

2. **Update `docs/agents/state.md`:** move the task to "Done" as one line, and
   add anything that belongs under "Known problems".
3. **Append to `docs/agents/decisions.md`** if the work settled something worth
   keeping — a deviation from Java, a design choice with consequences. Append
   at the bottom; never reword what is there.
4. **Release the claim:** remove the block from "Live claims" and free any
   shared resources it held.
5. **Commit and push:**

   ```bash
   git push -u origin feat/<slug>
   ```

6. **Open the pull request.** `gh` is not installed here, so give the human the
   link:

   ```
   https://github.com/cash1981/playciv/compare/main...feat/<slug>?expand=1
   ```

   Draft the PR body for them to paste: what changed, why, what was verified
   with the real numbers, what was deliberately left out, and a link to the
   brief.

**The human merges.** Never merge to `main`, never force-push `main`. If the PR
needs changes, push more commits to the branch.
