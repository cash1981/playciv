# Roles

The orchestrator defines scope and judges evidence; implementation and review
remain separate. Host adapters contain the actual model/tool configuration.
Keep shared rules here so Claude, Codex and OpenCode do not drift apart.

| Role | Responsibility | May change files? |
| --- | --- | --- |
| Orchestrator | Scope, claims, decisions, verification evidence, review approval and PR | Yes |
| Coder | Implement the assigned brief within claimed paths | Yes |
| Reviewer | Independently check the diff and report findings | No |
| Rules-checker, where configured | Check relevant rules, deck/log/projection changes | No |

## Coder

Read the active brief and relevant conventions, then implement on the supplied
feature branch/isolated checkout. Report a required scope expansion before
editing unclaimed paths. Preserve engine purity and hidden-information tests.
Run required verification and report actual output, limitations and departures
from the brief. Do not weaken tests, invent rules, approve your own work, merge,
force-push or open a PR; the orchestrator handles the handover.

Use the host's configured cheaper implementation model when suitable; decisions
and uncertain requirements belong with the orchestrator. If repeated failed
rounds justify escalation, use a stronger available implementation model while
preserving independent review.

## Reviewer

Read the complete proposed diff and brief. Inspect relevant surrounding files
when needed; do not read every historical task. Use the supplied verification
results. Do not write, edit, run commands or fix findings. Native host adapters
restrict tools where supported; instructions are not a claim that every host
provides the same permission controls.

Prioritize:

1. Hidden-information leaks and missing projection tests.
2. Incorrect behavior, unrecorded behavior changes and invented game rules.
3. Engine impurity, mutation and invalid error handling.
4. Tests that miss the intended regression or pass by luck.
5. Acceptance criteria, current conventions, and misleading documentation.

Return [the review report](templates/review-report.md): verdict, concrete
findings with file/line and failure case, uncertainty, and checks you could not
perform. Distinguish a defect from a suspicion or nit. On another round, verify
that prior findings were resolved.

## Rules-checker

When the host configures this role, compare a relevant rules/deck/log/projection
change with current code/tests, current decisions and the applicable rulebook.
Cite files/lines or pages. Old Java is optional historical evidence, not the
specification. Report unsupported rules and unavailable sources explicitly;
do not guess or modify files. This supplements general review.

## Orchestrator and approval

Judge each finding against evidence and have the implementer fix real issues.
Review after the first implementation and repeat until nothing above a nit
remains. Explicitly approve the result; the reviewer's verdict is input, not
permission to merge. Record accepted nits and material limitations in the PR.
The human merges. Follow [workflow.md](workflow.md) for the full lifecycle.

## Host adapters

- Claude: `.claude/agents/` and `.claude/skills/`.
- Codex: `.codex/agents/` and `.agents/skills/`.
- OpenCode: `.opencode/agents/`, using the shared skill procedure where supported.

Preserve configured model and tool restrictions. Codex's review-gate adapter
requires Sol (`gpt-5.6-sol`); do not silently substitute another model. No shared
document should assume a particular shell, installed browser tool or OS.
