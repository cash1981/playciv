# OpenCode always runs a read-only review loop

- **Slug:** `opencode-readonly-review-loop`
- **Branch:** `chore/opencode-readonly-review-loop`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

Make the OpenCode workflow run a **read-only code review after the first
implementation** of every change, hand the findings back, and repeat until a
round reports nothing above a nit — instead of the review being an optional step
the orchestrator may skip before the pull request.

OpenCode today has no `reviewer` subagent: `roles.md` says the orchestrator
"does the correctness check itself". The owner wants a separate, read-only pass
that cannot write, run automatically after the first implementation and iterated
to zero findings, matching what Claude Code already does through
`.claude/agents/reviewer.md` and `/review-gate`.

## Scope

**In:**

- New `.opencode/agents/reviewer.md`: read-only, permissions deny everything
  except read/glob/grep/external_directory, mirroring `.claude/agents/reviewer.md`.
- The rule itself, stated in the four places a worker reads it:
  `AGENTS.md` (rule 4), `docs/agents/workflow.md` (step 5),
  `docs/agents/roles.md`, and `.claude/skills/review-gate/SKILL.md`.
- `docs/agents/repo-map.md`: the `.opencode/` row no longer says "no reviewer".

**Out:**

- Any change to the `coder` or `rules-checker` agents, to the model split, or to
  product code. This is process documentation plus one agent definition.

## Approach

State the loop once, in `workflow.md`, and reference it from the other three.
The loop: after the first implementation, verify, write the diff outside the
repo, spawn the read-only `reviewer` (and `rules-checker` when the change is
rule-bearing), fix every finding the orchestrator judges real, and repeat the
review on the new diff until a round reports no findings above nit level. Nits
the orchestrator chooses to leave are recorded in the review verdict.

## Claimed paths

- `.opencode/agents/reviewer.md` (new)
- `AGENTS.md`
- `docs/agents/workflow.md`
- `docs/agents/roles.md`
- `docs/agents/repo-map.md`
- `.claude/skills/review-gate/SKILL.md`
- `docs/agents/tasks/opencode-readonly-review-loop.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] `.opencode/agents/reviewer.md` exists and is read-only by permissions.
- [ ] `AGENTS.md`, `workflow.md`, `roles.md` and the review-gate skill all say the read-only review runs after the first implementation and iterates until a round is clean.
- [ ] `roles.md` and `repo-map.md` no longer claim OpenCode has no reviewer.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (documentation-only change).
