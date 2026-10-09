# Agent documentation

Keep the default reading small and current. Start with `AGENTS.md`, `state.md`
and `task-board.md`; use the other files only when the task needs them.

| File | Purpose and maintenance |
| --- | --- |
| [state.md](state.md) | Current orientation, ideally under 80 lines; no delivery ledger or stale test totals. |
| [task-board.md](task-board.md) | Active path claims and explicitly queued work; clear ownership on release. |
| [repo-map.md](repo-map.md) | Find relevant packages/files without reading the whole codebase. |
| [conventions.md](conventions.md) | Coding and privacy rules. |
| [workflow.md](workflow.md) | One canonical workflow for every host. |
| [roles.md](roles.md) | Author, orchestrator and independent reviewer responsibilities. |
| [decisions.md](decisions.md) | Current rationale and compatibility requirements, organized by topic. |
| [limitations.md](limitations.md) | Concrete limitations and unverified risks; not an automatic work queue. |
| [tasks/README.md](tasks/README.md) | Active brief lifecycle and historical citation redirects. |
| [templates/](templates/) | Brief and review-report formats. |
| [../history/README.md](../history/README.md) | Retrieve retired documents from Git when history is needed. |

## Keeping it useful

- Put a fact in one place and link to it. README describes the product; code and
  tests define current behavior; decisions explain important reasons.
- Update or replace a superseded current decision in place, noting why and
  linking its replacement. Git preserves the original; do not append contradictory
  instructions indefinitely.
- Keep task briefs while work is active or under review. After merge, preserve
  durable decisions and unresolved requirements in the appropriate current
  document, then retire the brief in a subsequent change. Keep an explicitly
  historical redirect only if source/tests/data still cite that path.
- Unchecked historical acceptance criteria are not proof that work is pending.
  Verify against merged code before adding an item to the queue.
- Model selection and tool permissions belong in host adapters. Shared workflow
  must not assume Windows, a specific preview tool or a particular cloud machine.
