# Reduce stale agent documentation

- **Slug:** `agent-docs-cleanup`
- **Branch:** `chore/agent-docs-cleanup`
- **Owner:** Codex
- **Status:** ready for review

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

- `AGENTS.md`, `CLAUDE.md`, `README.md`
- `docs/agents/`, `docs/history/`
- `.agents/skills/feature/`, `.agents/skills/review-gate/`
- `.claude/skills/feature/`, `.claude/skills/review-gate/`
- `.claude/agents/`, `.opencode/agents/`, `.codex/agents/`

## Acceptance criteria

- [x] Every pre-existing task brief and the full state/decision logs are reviewed.
- [x] Startup documents are concise and describe current behavior and workflow.
- [x] Historical plans cannot be mistaken for active requirements.
- [x] Durable constraints and unresolved work remain discoverable.
- [x] A documented Git path retrieves retired material.
- [x] Links and paths affected by the cleanup resolve.
- [x] No application source, tests, manifests or lockfiles change.
- [x] Typecheck, all tests and builds pass; an independent review has no findings.

## Open questions

None blocking the documentation cleanup. Unconfirmed feature/deployment status
must be reported as unconfirmed, not silently marked complete.

## Validation and review

- `pnpm -r typecheck`: passed.
- `pnpm -r test`: 2,031 passed (895 engine, 608 server, 528 web).
- `pnpm -r build`: passed.
- Local Markdown links/anchors and quoted repository paths checked; all eleven
  historical redirects resolve to the original Git blobs; three Codex TOML
  adapters parse; `git diff --check` passed.
- Independent Sol reviews covered workflow/adapters, task retirement, and current
  reference accuracy. Reference review restored five important qualifications:
  game-chat permissions, public artwork rationale, legacy board shapes, Egypt's
  forward-only wonder deal, and wonders retained in legacy hands. All three
  final reviews have zero remaining findings; orchestrator approved.
- No application source, tests, generated data, manifests or lockfiles changed.
  No browser or production checks were needed for this documentation change.
- Path claim released. Retain this brief during PR review, then retire it using
  the documented lifecycle after merge.
