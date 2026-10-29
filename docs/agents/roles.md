# Roles

The orchestrator owns scope and judges evidence; implementation and review stay
separate. Model and tool configuration lives in the host adapters.

| Role | Responsibility | Changes files? |
| --- | --- | --- |
| Orchestrator | Scope, claims, decisions, verification, approval, PR | Yes |
| Coder | Implement the brief within claimed paths | Yes |
| Reviewer | Check the diff independently and report findings | No |
| Rules-checker (where configured) | Check rules, deck, log and projection changes | No |

## Coder

Implement the active brief on the given branch or checkout. Report a needed
scope expansion before touching unclaimed paths. Keep the engine pure and the
hidden-information tests intact. Run verification and report real output and
departures from the brief. Do not weaken tests, invent rules, approve your own
work, merge, force-push or open a PR. After repeated failed rounds the
orchestrator may switch to a stronger model, keeping review independent.

## Reviewer

Read the full diff and the brief, plus surrounding files as needed; never every
historical task. Do not write, edit, run commands or fix findings. Priorities:

1. Hidden-information leaks and missing projection tests.
2. Wrong behavior, unrecorded behavior changes, invented rules.
3. Engine impurity, mutation, invalid error handling.
4. Tests that miss the regression or pass by luck.
5. Acceptance criteria, conventions, misleading docs.

Return [the review report](templates/review-report.md): verdict, findings with
file/line and failure case, uncertainty and checks not performed. On later
rounds, confirm earlier findings were resolved.

## Rules-checker

Compare a rules, deck, log or projection change with the code, tests, decisions
and rulebook, citing files or pages. Old Java is optional evidence, not the
specification. Report unsupported rules and missing sources; never guess.

## Orchestrator

Judge each finding, have the coder fix real issues, and repeat review until
nothing above a nit remains. Approve explicitly and record accepted nits and
limits in the PR. The human merges.

## Host adapters

- Claude: `.claude/agents/` and `.claude/skills/`.
- Codex: `.codex/agents/` and `.agents/skills/`. Its review gate requires Sol
  (`gpt-5.6-sol`); do not substitute another model.
- OpenCode: `.opencode/agents/`, using the shared skills where supported.

No shared document may assume a particular shell, browser tool or OS.
