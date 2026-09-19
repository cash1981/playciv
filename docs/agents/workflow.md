# Workflow

How a change gets from an idea to `main`. The shape is the same whether the
work is done by Claude, by Codex, or by hand.

```
  read history ──▶ claim ──▶ branch ──▶ code ──▶ verify ──▶ review gate ──▶ approve ──▶ PR ──▶ human merges
       │             │         ▲                      │
       │             │         └──── rejected ────────┘
       │             └── released when the branch is merged or abandoned
       └── every turn, because other agents commit between yours
```

## 0. Read the git history

Do this every time, before anything else — several agents commit here, often
between your turns, and the docs can lag behind the commits.

```bash
git fetch origin --prune
git log --oneline -20 --all --decorate
git status
git log --oneline origin/main..HEAD
```

If `main` has moved, rebase your branch onto it before adding more, so your diff
stays clean:

```bash
git rebase origin/main
```

If another agent has committed to the branch you are picking up, read those
commits first — the code is not where you last left it. A file reported as
changed on disk since you read it means someone else has edited it; re-read
before you write.

## 1. Claim the work

Add a block to `task-board.md` before editing anything. List the paths you will
touch. This is the only thing standing between two parallel agents and a mess.

If a live claim already lists a path you need:

- **Do not edit it.** Not even "just one line".
- Either pick different work, or ask the orchestrator to sequence the two tasks.

Claims are by path, not by feature, because that is what actually collides.

## 2. Branch and worktree

Never commit on `main` or in the shared checkout. Every agent must use a
dedicated git worktree so simultaneous agents and the human cannot overwrite
each other's working files. One branch per feature:

```bash
git fetch origin --prune
git worktree add ../civ-<slug> -b feat/<slug> origin/main
cd ../civ-<slug>
```

Prefixes: `feat/` for features, `fix/` for defects, `chore/` for tooling and
docs, `refactor/` for changes with no behaviour difference.

Claude's Agent tool must use `isolation: "worktree"`; Codex agents must create
and work inside an equivalent git worktree. Before merging, fetch `origin` and
rebase the feature branch onto the current `origin/main` in its worktree.

## 3. Code

Write a task brief in `docs/agents/tasks/<slug>.md` first, from the template.
It costs a minute and it is what the reviewer checks against — a reviewer with
no statement of intent can only check style.

Then implement. Small commits. Stay inside the paths you claimed.

## 4. Verify

Run all three and keep the output. This is not optional and the result is
reported honestly, including failures:

```bash
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

If the change is visible in the browser, check it there too and say what you
saw. "It should work" is not verification.

## 5. The review gate

**The coder never merges its own work.** Code is written by the `coder` role on
a cheaper model; it is checked by a `reviewer` role on a stronger model that
**cannot write**. See `roles.md` for why.

The orchestrator drives it:

1. Write the diff somewhere outside the repo, so the reviewer can read it
   without the repo being polluted:

   ```bash
   git diff main...HEAD > "$SCRATCH/review-<slug>.diff"
   ```

2. Spawn the reviewer with: the diff path, the task brief path, and the
   verification output. The reviewer returns a report; it has no way to write
   one, which is the point.

3. Read the report. Then decide:

   - **Approved** — go to step 6.
   - **Changes needed** — hand the findings back to the coder and repeat from
     step 3. Do not fix them yourself in passing; the loop is what keeps the
     cheap model honest.

   The orchestrator is the only role that can approve. A reviewer saying
   "looks good" is an input to that decision, not the decision.

4. Record anything worth keeping in `decisions.md`.

In Claude this is the `/review-gate` skill; the `reviewer` and `rules-checker`
subagents are in `.claude/agents/`. In OpenCode the `coder` and `rules-checker`
agents are in `.opencode/agents/` and the `/review-gate` skill runs as before,
except that there is no reviewer subagent — the orchestrator does the
correctness check itself. In Codex, do the same by hand: generate the diff, open
a separate conversation on a stronger model with the diff and the brief, and
paste its report back.

## 6. Pull request

```bash
git push -u origin feat/<slug>
```

`gh` is not installed on this machine, so the push output prints a link that
opens the pull request form. Use it, or:

```
https://github.com/cash1981/playciv/compare/main...feat/<slug>?expand=1
```

The PR body should say what changed, why, what was verified, and what was
deliberately left out. Link the task brief.

**The human merges.** No agent merges to `main`, and no agent force-pushes
`main`. If a PR needs changes, push more commits to the branch.

## 7. Close out

- Update `state.md`: move the task from "in progress" to "done", one line.
- Release the claim in `task-board.md`.
- After the PR/compare link has been supplied and the working tree is clean,
  remove the dedicated local worktree from another checkout with
  `git worktree remove <feature-worktree>`. This removes only the checkout;
  keep the local and remote feature branches so the human can check out the
  branch for testing. Do not use `--force` for routine cleanup.

A task that leaves the board or the state file stale is not finished, because
the next agent will act on what those files say.

## Parallel work, practically

- **Claims are by path.** Two agents in `packages/web/src/views/` are fine if
  they are in different files, and a disaster if they are not.
- **`decisions.md` is append-only.** Add at the bottom. Two agents appending
  different blocks merge cleanly; two agents rewording the same paragraph do
  not.
- **`state.md` and `task-board.md`: edit your own block only.**
- **Generated files are a shared resource.** `board-assets.json` and the
  artwork folders are rewritten wholesale by the generators. Only one task at a
  time may own them; claim them explicitly.
- **Rebase, do not merge, while a branch is in flight.** `git rebase main`
  keeps the history readable and the diff honest.
