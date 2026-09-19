# Opencode agent definitions

- **Slug:** `opencode-agents`
- **Branch:** `chore/opencode-agents`
- **Owner:** OpenCode (DeepSeek V4.1 Flash)
- **Status:** done — self-checked against the OpenCode agent spec, PR to open

## Goal

The coder and rules-checker roles and the `feature` / `review-gate` skills should
work in OpenCode, not only in Claude Code. After this, an OpenCode orchestrator
can spawn the coder and the read-only rules-checker, and — because OpenCode runs
the same model throughout — does the general correctness check itself instead of
spawning a reviewer.

## Why

`docs/agents/roles.md` said the roles "are defined in `.claude/agents/` and
spawned with the Agent tool". That is Claude-specific. OpenCode discovers
project agents under `.opencode/agents/`, and the two slash-command skills
already load in OpenCode from `.claude/skills/`, so only the role agents were
missing.

The owner then asked to drop the reviewer in OpenCode: the same model is used
throughout, so a second pass on a "stronger" model buys nothing. The
orchestrator does the correctness check itself against the brief and the old
system. `rules-checker` stays — it answers a different question (does this match
the old backend and client) and is a separate read-only context.

## Scope

**In:**

- `.opencode/agents/coder.md` and `rules-checker.md`, ported from the
  `.claude/agents/` definitions.
- `rules-checker` is read-only: no edit, no shell, no subagent.
- `coder` runs on a cheaper model and cannot spawn subagents.
- Pointers in `docs/agents/roles.md`, `docs/agents/repo-map.md` and
  `docs/agents/workflow.md`.

**Out:**

- Changing the process itself, the skills, or the `.claude/` definitions; the
  Claude reviewer role is untouched.
- Registering the skills in `.opencode/skills/` — they already load from
  `.claude/skills/`; moving them is not needed and would duplicate them.

## Reference

- `.claude/agents/coder.md`, `reviewer.md`, `rules-checker.md` — the source.
- `.claude/skills/feature/SKILL.md`, `.claude/skills/review-gate/SKILL.md`.
- `docs/agents/roles.md`, `docs/agents/workflow.md`.
- OpenCode V2 agent docs: <https://opencode.ai/v2/docs/agents/>
  (`.opencode/agents/<name>.md`, `mode: subagent`, `permissions` as an ordered
  list of `{ action, resource, effect }`; the last matching rule wins).

## Approach

Each file mirrors its `.claude/agents/` counterpart: same description and body,
with the frontmatter translated to the OpenCode V2 shape.

- `coder` — `mode: subagent`, `deepseek/deepseek-v4-flash-vision-exp` (the cheap
  model), and `subagent` denied so it cannot recursively spawn.
- `rules-checker` — `mode: subagent`, `deepseek/deepseek-v4-pro`, and a broad
  `deny` followed by `read` / `glob` / `grep` / `external_directory` allows. The
  diff it reads is written outside the repo, hence the `external_directory`
  allow.

Model IDs are the ones configured in this OpenCode instance; swap the `model:`
lines when the available models change.

## Claimed paths

- `.opencode/agents/coder.md` (new)
- `.opencode/agents/rules-checker.md` (new)
- `docs/agents/tasks/opencode-agents.md` (new)
- `docs/agents/roles.md`
- `docs/agents/repo-map.md`
- `docs/agents/task-board.md` (own claim block only)
- `docs/agents/workflow.md` (the review-gate mention only)
- `docs/agents/state.md`

## Acceptance criteria

- [x] `coder.md` and `rules-checker.md` exist under `.opencode/agents/` with
      `mode: subagent`; there is no `reviewer.md`.
- [x] `rules-checker` cannot edit or run anything: a `deny` rule covers `*`
      before the read-only allows.
- [x] `coder` cannot spawn subagents.
- [x] The bodies are the `.claude/agents/` texts, unchanged in substance (the
      Claude-only preview-pane note is dropped from `coder`, since OpenCode has
      no preview pane; the `reviewer` cross-reference is dropped from
      `rules-checker`).
- [x] `roles.md`, `repo-map.md` and `workflow.md` describe the OpenCode setup
      without claiming a reviewer subagent that does not exist.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (no code
      changed, so this is a no-regression check).

## Open questions

- Should the `feature` / `review-gate` skills move to `.opencode/skills/`? They
  already load from `.claude/skills/` in OpenCode, so this is left out. The
  human can decide later.
