# docs/agents

The working memory of this project. `AGENTS.md` in the root is the entry point;
this folder holds everything it links to.

It exists so that an agent starting a session does not have to read the
codebase to work out what is going on. Two files are **live** and change often;
the rest are stable and only change when the project does.

## The files

| File | Kind | What it is for |
| --- | --- | --- |
| `repo-map.md` | stable | What every folder and package is and does. Read once per session. |
| `conventions.md` | stable | The coding rules, in detail, with the reasoning. |
| `workflow.md` | stable | Branch, review gate, pull request. The process. |
| `roles.md` | stable | The agent roles, which model each uses, and what each may write. |
| `task-board.md` | **live** | Who is working on what, and which paths they have claimed. |
| `state.md` | **live** | Where the project stands: done, in progress, next, known problems. |
| `decisions.md` | append-only | Why things are the way they are. Never rewritten. |
| `tasks/` | per task | One brief per feature: goal, scope, acceptance criteria. |
| `templates/` | stable | Templates for a task brief and a review report. |

## How they fit together

```
                   AGENTS.md  ──────────────┐
                       │                    │  (CLAUDE.md imports it)
        ┌──────────────┼──────────────┐     │
        ▼              ▼              ▼     ▼
   repo-map.md   conventions.md   workflow.md
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
                    task-board.md              tasks/<slug>.md
                     (who, where)               (what, why, done when)
                          │                         │
                          └───────────┬─────────────┘
                                      ▼
                                  state.md
                             (the running summary)
                                      │
                                      ▼
                                decisions.md
                            (what we learned, forever)
```

## Rules for editing these files

- **`task-board.md` and `state.md` are shared.** Edit only your own entry.
  Rewriting someone else's block loses their work and causes merge conflicts.
- **`decisions.md` is append-only.** Add at the bottom, never reword what is
  already there. That keeps merges trivial and history honest.
- **Keep them short.** These files are read at the start of every session, by
  every agent. A `state.md` that has grown to 300 lines costs real money on
  every run. Prune finished work into one line; move the detail to
  `decisions.md` if it is worth keeping at all.
- **Stale is worse than missing.** A task board that says someone is working on
  a file when they are not will cause another agent to sit on its hands. Release
  your claim when you stop.
