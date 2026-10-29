# Workflow

The shared procedure. Host skills adapt tools and models; they do not change
these rules.

## 1. Inspect and claim

Read `AGENTS.md`, [state](state.md) and [active claims](task-board.md), then:

```bash
git status --short
git fetch origin --prune
git log --oneline -20 --all --decorate
```

Preserve other people's work; reconcile with `origin/main` before publishing
without resetting local work or rebasing a shared branch. Report remote checks
you could not run.

Claim paths in `task-board.md`, resolving any conflicting live claim first, and
write a short `tasks/<slug>.md` from the template. An authorized task needs no
second approval of its brief; ask only about unresolved requirements.

## 2. Isolate

Work on a `feat/`, `fix/`, `chore/` or `refactor/` branch, never `main`. In a
shared local checkout use a worktree:

```bash
git worktree add ../civ-<slug> -b feat/<slug> origin/main
```

An isolated cloud task may use its own checkout. Concurrent writers need their
own checkouts or disjoint claims; reviewers can read the author's checkout.

## 3. Implement and verify

Stay inside the claim, follow [conventions](conventions.md) and record behavior
changes in the matching [decisions](decisions.md) topic. The coder implements;
the orchestrator owns scope and decisions. Then, from the root:

```bash
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

Report real results. Never delete tests or weaken assertions to hide a failure.
Check visible changes in a browser when available and say what you could not
check. For docs, check links and paths.

## 4. Independent review

Review after the first implementation and after every fix, until nothing above
a nit remains. The author never self-reviews; see [roles](roles.md). Give the
reviewer the brief, the full diff (committed, staged and new files), real check
output and earlier findings, e.g.:

```bash
git diff --cached origin/main > <scratch>/review-<slug>.diff
```

Split large diffs by area without dropping files. Do not substitute a weaker
reviewer or claim a review that did not run. The orchestrator verifies each
finding and approves explicitly; a reported blocker is not approval.

## 5. Close out

- Update [state](state.md) only when orientation changed; never add a Done
  ledger or test totals.
- Once review approves, finish in one last commit on the branch: move durable
  rationale into decisions and open gaps into [limitations](limitations.md),
  then delete the brief and your task-board block. Nothing is left after merge.
- Commit, push and open a PR (`gh pr create --body-file <file>`) with problem,
  result, validation and limits. A compare link is not a PR; report blockers.
- **The human merges.** Never merge or force-push `main`.
- Afterwards remove only a clean, disposable worktree; keep the branches.
