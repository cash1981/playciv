# Use Sol for review

- **Slug:** `reviewer-policy`
- **Branch:** `chore/reviewer-policy`
- **Owner:** Codex/orchestrator
- **Status:** done

## Goal

All future review gates use the stronger Sol model as the default read-only
reviewer. Codex starts `gpt-5.6-sol` directly; Claude hands the review to a
Sol-compatible Codex task instead of trying to use an OpenAI model in Claude
Code configuration.

## Scope

Update the repository's agent instructions and local review-gate skill to name
Sol as the required reviewer. Keep the reviewer read-only and keep the
orchestrator responsible for the final approval.

## Acceptance criteria

- [x] `AGENTS.md`, `docs/agents/roles.md`, `docs/agents/workflow.md`, and the
  local review-gate skill all require Sol for reviews, with a valid Claude
  handoff path documented.
- [x] The instructions continue to require dedicated worktrees.
- [x] No coding or runtime behavior changes.
- [x] The task board and state are updated and the branch is pushed.
