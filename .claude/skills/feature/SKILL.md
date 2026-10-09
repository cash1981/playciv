---
name: feature
description: Start, resume or finish a feature — branch, task claim, brief and pull request. Use when the human names a feature to work on, asks to pick up the next queued task, or says a feature is done. Handles the bookkeeping in docs/agents/ so the task board and state file never go stale.
---

# Feature

Follow `AGENTS.md` and the canonical lifecycle in `docs/agents/workflow.md`;
roles and write boundaries are in `docs/agents/roles.md`.

Argument: a task slug, `next`, `status`, or `finish`.

- **Start/resume:** inspect current history and claims, read or create the active
  brief, and claim the required paths. Follow the workflow's checkout isolation
  rule, including its already-isolated cloud exception. Do not switch branches
  in a shared checkout. An already-authorized request does not need another
  approval merely because its brief is new. Resolve only questions that block
  useful progress; implement within the authorized scope.
- **Status:** report current claims, queue, branch and working-tree status.
- **Finish:** require the workflow's verification and independent read-only
  review, fix findings and review again. Keep `state.md` bounded to current
  facts and `decisions.md` to current durable rationale. Retire completed briefs
  using `docs/history/README.md`; release your claim, commit, push and open a PR
  through the available GitHub tooling. Report the actual PR link and check
  results. The human merges; never merge or force-push `main`.

Use the actual shell, tools and credentials provided by the session. Report a
missing capability honestly instead of assuming a particular OS or CLI exists.
