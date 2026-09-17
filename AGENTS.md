# AGENTS.md

Entry point for every coding agent working in this repository — Claude Code,
Codex, or a human reading over their shoulder. Claude reads it through
`CLAUDE.md`, which imports this file; Codex reads it directly.

**Read this file in full. Then read only what the task needs** — the point of
`docs/agents/` is that you should never have to re-read the codebase to find
your bearings.

## What this project is

A rewrite of the play-by-forum engine for *Sid Meier's Civilization: The Board
Game* (Fantasy Flight), with the *Fame and Fortune* and *Wisdom and Warfare*
expansions. It replaces two dead repositories that are still on disk as
reference material: `old-civ-rest` (Java 8 / Dropwizard / MongoDB) and
`old-civ-web` (AngularJS 1). Both are gitignored.

`README.md` is the human-facing description of the product. This file and
`docs/agents/` are about how we work on it.

## The five rules that never bend

1. **The old system is the reference.** The business logic to reproduce is what
   the old backend (`old-civ-rest`, Java) and the old client (`old-civ-web`,
   AngularJS) did *between them* — the two together implement it, not the Java
   alone. Reproduce their combined behaviour. Where the same rule is
   implemented in both and they disagree, the backend wins and its tests are
   the strongest evidence; where logic lived only in the old client, that
   client is the reference for it. If you think the old system is wrong, port
   it as it is and write the disagreement down in `docs/agents/decisions.md`.
2. **Do not invent FFG rules.** If a rule is unclear, read the old backend and
   the old client and their tests. If it is still unclear, stop and ask the
   human. Guessing a board game rule and encoding it is worse than leaving it
   undone.
3. **The engine is pure.** Every reducer is
   `(state, input) => Result<GameState, EngineError>`. No exceptions, no
   `Date.now()`, no `Math.random()`, no I/O. Time and randomness are passed in.
4. **Hidden information must not leak.** A player's hand, private log and
   unrevealed techs never reach another client. Anything added to a projection
   needs a test proving it does not leak.
5. **TypeScript strict, and English throughout.** Code, comments, tests, UI
   strings, commit messages and these docs are in English. Conversation with
   the human is in Norwegian.

## Where to look

| You need | Read |
| --- | --- |
| What each folder and package is for | `docs/agents/repo-map.md` |
| The coding rules in detail | `docs/agents/conventions.md` |
| How a change gets from idea to merged | `docs/agents/workflow.md` |
| Who does what, and who may write | `docs/agents/roles.md` |
| What is being worked on right now | `docs/agents/task-board.md` |
| Where the project currently stands | `docs/agents/state.md` |
| Why something is the way it is | `docs/agents/decisions.md` |

Start any session by reading `state.md` and `task-board.md`. They are short and
kept current on purpose, so two agents can work at once without reading the
same 20 files.

## Check the git history first — always

Several agents (Claude, Codex/Luna, Terra, and the human) commit to this
repository, often on the same branch and often between your turns. **Before you
plan or touch anything, read what has already happened.** The docs can lag; the
git history cannot.

```bash
git fetch origin --prune
git log --oneline -20 --all --decorate     # what landed, on which branch
git status                                   # your branch, uncommitted work
git log --oneline origin/main..HEAD          # commits on your branch not yet on main
```

Then reconcile: if `main` moved, rebase your branch onto it
(`git rebase origin/main`) before you add to it, so you build on the latest and
your eventual diff stays clean. If another agent has committed to the branch you
are on, read those commits before writing — do not assume the code is where you
last left it. A file changed on disk since you read it is a signal that someone
else has been here.

## Before you touch anything

1. **Read the git history** (above). Know what the other agents have done.
2. **Claim your work** in `docs/agents/task-board.md`, listing the paths you
   will edit. If another live claim already lists a path you need, stop and
   negotiate rather than editing it.
3. **Work on a feature branch**, never on `main`. See `workflow.md`.
4. **Nothing merges without a review pass.** Code is written by the coder role
   and checked by a reviewer role that has no write access. The orchestrator —
   the main agent, or the human — is the only one who can approve. See
   `roles.md`.

## Before you finish

Run all three, and report the real output:

```bash
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

Then update `state.md` and release your claim on the task board. A task that
leaves those stale has not been finished.
