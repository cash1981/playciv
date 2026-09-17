# Use Sol for review

- **Slug:** `reviewer-policy`
- **Branch:** `chore/reviewer-policy`
- **Owner:** Codex/orchestrator
- **Status:** in progress

## Goal

All future review gates use the stronger Sol model as the default read-only
reviewer, so feature branches receive a consistent and more rigorous review.

## Scope

Update the repository's agent instructions and local review-gate skill to name
Sol as the required reviewer. Keep the reviewer read-only and keep the
orchestrator responsible for the final approval.

## Acceptance criteria

- [ ] `AGENTS.md`, `docs/agents/roles.md`, `docs/agents/workflow.md`, and the
  local review-gate skill all require Sol for reviews.
- [ ] The instructions continue to require dedicated worktrees.
- [ ] No coding or runtime behavior changes.
- [ ] The task board and state are updated and the branch is pushed.
