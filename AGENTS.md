# Agent instructions

Read this file, [current state](docs/agents/state.md) and
[active claims](docs/agents/task-board.md) at session start. Then read only the
brief, source, tests and reference sections needed for the task. Do not load all
of `docs/agents/`, all task briefs or historical logs into every session.

## Project and invariants

Playciv implements *Sid Meier's Civilization: The Board Game* with *Fame and
Fortune* and *Wisdom and Warfare*. [README.md](README.md) describes the product.

1. **Current code and tests are the reference.** Old Java/Angular repositories
   and retired briefs explain history; they do not specify current behavior.
   Record intentional rule or visible behavior changes in the relevant section
   of [decisions.md](docs/agents/decisions.md), with a regression test.
2. **Do not invent FFG rules.** Consult the relevant rulebooks, current code and
   tests. Rulebooks in `Civilization/` are untracked and may be absent. Ask for
   genuinely missing rules; do not infer them from a superseded implementation.
3. **The engine is pure.** Reducers return `Result<GameState, EngineError>`;
   no exceptions, clock, unseeded randomness, I/O or mutation of input state.
4. **Keep hidden information private.** Changes to projections need tests
   showing that hands, private notes/logs and unrevealed cards cannot leak.
5. **TypeScript strict; English in repository files.** Conversation with the
   human is Norwegian. Follow [conventions.md](docs/agents/conventions.md).

## Working on a change

- Inspect `git status`, recent history and the relevant diff before editing.
  Fetch `origin` when available; reconcile changes without overwriting others'
  files or local commits. See [workflow.md](docs/agents/workflow.md).
- Claim paths in `task-board.md` and write a concise active task brief. Resolve
  overlapping live claims before editing. Do not revive an old task from an
  unchecked checkbox or stale status in Git history.
- Use a feature branch. In a shared checkout, use a dedicated worktree. An
  already isolated cloud task may use its existing checkout on a feature branch;
  another worktree is unnecessary unless requested. Never commit on `main`.
- Read-only review is independent of the author. Fix findings and repeat until
  none above a nit remains; the orchestrator decides approval. Role boundaries
  and host adapters are in [roles.md](docs/agents/roles.md).
- Verify from the repository root and report actual results:

  ```bash
  pnpm -r typecheck && pnpm -r test && pnpm -r build
  ```

  Check visible behavior in a browser when relevant and available; disclose
  checks not performed. Documentation changes also need link/path checks.
- Keep current state short, update only relevant current decisions, and release
  claims. Put test totals and delivery details in the PR, not a growing Done log.
  The human merges; do not merge or force-push `main`.

## Read on demand

| Need | Reference |
| --- | --- |
| Package and source locations | [repo-map.md](docs/agents/repo-map.md) |
| Coding conventions | [conventions.md](docs/agents/conventions.md) |
| Branch, review and PR procedure | [workflow.md](docs/agents/workflow.md) |
| Role boundaries | [roles.md](docs/agents/roles.md) |
| Current rationale and compatibility | [decisions.md](docs/agents/decisions.md) — relevant topic only |
| Known limitations | [limitations.md](docs/agents/limitations.md) — relevant topic only |
| Historical briefs and decisions | [Git history guide](docs/history/README.md) — explicit historical questions only |
