# Use Sol for review

- **Slug:** `reviewer-policy`
- **Branch:** `chore/reviewer-policy`
- **Owner:** Codex/orchestrator
- **Status:** done

## Goal

Codex review gates use the stronger Sol model as the default read-only
reviewer. Claude's Sonnet/Opus workflow is unchanged.

## Scope

Update the repository's agent instructions and local review-gate skill to name
Sol as the required reviewer. Keep the reviewer read-only and keep the
orchestrator responsible for the final approval.

## Acceptance criteria

- [x] The Codex review-gate skill requires Sol for reviews; Claude's native
  reviewer configuration remains unchanged.
- [x] The instructions continue to require dedicated worktrees.
- [x] No coding or runtime behavior changes.
- [x] The task board and state are updated and the branch is pushed.
