# Reduce stale agent documentation

- **Slug:** `agent-docs-cleanup`
- **Branch:** `chore/agent-docs-cleanup`
- **Owner:** Codex
- **Status:** in progress

## Goal

Give agents a short, current starting point without treating historical feature
plans as live requirements. The user requested a PR after reviewing past changes,
removing unnecessary material and correcting other documentation problems found.

## Scope

Agent instructions, workflow/role documentation and host adapters, task briefs,
state/decision documentation, and related README corrections. Application source,
tests, package manifests, lockfiles and runtime behavior are outside this task.

## Approach

Read all existing task briefs, the state and decision logs, and Git history.
Check potentially unfinished work and superseded requirements against current
code. Remove redundant delivery summaries and obsolete plans; retain unresolved
requirements explicitly without claiming implementation or deployment. Keep
valuable rationale accessible on demand and define a bounded reading/lifecycle
policy so completed tasks do not accumulate again.

## Claimed paths

See the `agent-docs-cleanup` entry in `../task-board.md`.

## Acceptance criteria

- [ ] Every pre-existing task brief and the full state/decision logs are reviewed.
- [ ] Startup documents are concise and describe current behavior and workflow.
- [ ] Historical plans cannot be mistaken for active requirements.
- [ ] Durable constraints and unresolved work remain discoverable.
- [ ] A documented Git path retrieves retired material.
- [ ] Links and paths affected by the cleanup resolve.
- [ ] No application source, tests, manifests or lockfiles change.
- [ ] Typecheck, all tests and builds pass; an independent review has no findings.

## Open questions

None blocking the documentation cleanup. Unconfirmed feature/deployment status
must be reported as unconfirmed, not silently marked complete.
