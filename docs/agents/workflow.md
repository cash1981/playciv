# Workflow

This is the shared procedure. Host-specific skills adapt tools and models;
they do not duplicate the process or change repository rules.

## 1. Inspect and claim

Read `AGENTS.md`, current state and active claims. Inspect the working tree and
recent Git history, fetching current references when network access permits:

```bash
git status --short
git fetch origin --prune
git log --oneline -20 --all --decorate
git log --oneline origin/main..HEAD
```

Check for intervening changes before editing; preserve other people's work.
Reconcile with `origin/main` before publishing, without resetting local work or
rebasing someone else's shared branch. Report unavailable remote checks.

Claim paths in `task-board.md`; resolve a conflicting live claim before editing.
Write a short `tasks/<slug>.md` from the template, scoped to the user's request.
An already authorized task does not need another approval of its brief. Ask
only about genuinely unresolved requirements that affect the result.

## 2. Isolate the work

Use a feature branch (`feat/`, `fix/`, `chore/` or `refactor/`). Never commit on
`main`. For shared local checkouts, create a dedicated worktree:

```bash
git worktree add ../civ-<slug> -b chore/<slug> origin/main
```

In an already isolated cloud task, use its existing checkout on a feature
branch; do not create another worktree unless requested. Each concurrent writer
needs its own checkout or explicitly disjoint claimed paths. Read-only reviewers
can inspect the author's checkout. Claude's writable agent isolation should be
`worktree` when writers could otherwise share a checkout.

Commit the claim and brief so collaborators can discover the scope. Do not
switch the user's shared checkout to `main` as part of a helper skill.

## 3. Implement and verify

Stay inside the claim. Apply the relevant conventions; record material behavior
changes and their rationale in the current decision topic. Use the configured
coder for implementation; the orchestrator owns scope and decisions. Report
missing tools, data or genuinely unclear rules without guessing.

From the repository root, run:

```bash
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

Preserve command exit codes and report actual results. Never delete tests or
weaken assertions to hide a failure. Check visible changes in a browser when
available; say what was observed and what could not be checked. For docs,
validate changed links, paths and examples against the current repository.
Reuse still-valid check results; rerun affected checks after meaningful changes.

## 4. Independent review

Run review after the first implementation and verification, and repeat after
fixes until no finding above a nit remains. The author does not self-review.
The [roles](roles.md) define the read-only reviewer and orchestrator boundaries.

Give the reviewer the active brief, the complete proposed diff, real check
output and previous findings. Capture both committed and working-tree edits;
include new files rather than omitting them from review. For example, after
staging the intended files, write a diff outside the checkout:

```bash
git diff --cached origin/main > /tmp/review-<slug>.diff
```

Use a suitable scratch location on the current host. Split large diffs by area
without leaving deletions or new files unreviewed. Host adapters specify reviewer
models and any additional rules check. Do not silently substitute a weaker
configured reviewer or claim a review that did not run.

The reviewer returns findings with concrete failure cases. The orchestrator
checks each finding, directs corrections, and explicitly approves when only
accepted nits remain. Document accepted nits in the review/PR, not an expanding
permanent transcript. A reported blocker is not approval.

## 5. Close out and propose a PR

- Update current state only when orientation or limitations changed. Do not
  append a Done ledger, historical branch status or old test totals.
- Update current decision topics with durable rationale. Retain unresolved
  constraints in `limitations.md` or explicitly queued work, not buried in an
  obsolete brief. Git preserves superseded versions.
- Mark the brief as ready for review, include actual validation, and release
  the path claim and resource ownership when implementation stops. Keep the
  brief while the PR is open; after merge it can be retired in a later change.
- Commit and push the feature branch. Create a PR with the problem, result,
  validation and material limits. Use `gh pr create --body-file <file>` when
  available; if blocked, keep the branch and prepared body and report the
  precise blocker. A compare link is not a created PR.
- **The human merges.** Never merge or force-push `main`.

After supplying the PR link and ensuring a dedicated local worktree is clean,
remove only that disposable worktree from another checkout if it is no longer
needed. Keep the feature branch and remote branch. Do not remove a managed
cloud task's primary checkout or use `--force` to discard local files.

## Brief lifecycle

`tasks/` is for active/reviewable work. Remove a completed brief after preserving
its durable decisions and concrete unresolved requirements. Source-cited retired
paths may remain as short historical redirects; never leave obsolete acceptance
criteria looking actionable. See [tasks/README.md](tasks/README.md) and
[history retrieval](../history/README.md).
