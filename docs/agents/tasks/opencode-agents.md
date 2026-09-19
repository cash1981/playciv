# Opencode agent definitions

- **Slug:** `opencode-agents`
- **Branch:** `chore/opencode-agents`
- **Owner:** OpenCode (DeepSeek V4.1 Flash)
- **Status:** done — review approved, PR to open

## Goal

The coder / reviewer / rules-checker roles and the `feature` / `review-gate`
skills should work in OpenCode, not only in Claude Code. After this, an OpenCode
orchestrator can spawn the read-only reviewer and rules-checker subagents and
run the same review gate the process requires.

## Why

`docs/agents/roles.md` says the three roles "are defined in `.claude/agents/` and
spawned with the Agent tool". That is Claude-specific. OpenCode discovers
project agents under `.opencode/agents/`, and the two slash-command skills
already load in OpenCode from `.claude/skills/`, so only the role agents are
missing. Without them the review gate cannot run as designed in OpenCode.

## Scope

**In:**

- `.opencode/agents/coder.md`, `reviewer.md`, `rules-checker.md`, ported from
  the `.claude/agents/` definitions.
- `reviewer` and `rules-checker` are read-only: no edit, no shell, no subagent.
- A one-line pointer in `docs/agents/roles.md` and a `.opencode/` row in
  `docs/agents/repo-map.md`.

**Out:**

- Changing the process itself, the skills, or the `.claude/` definitions.
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
- `reviewer` / `rules-checker` — `mode: subagent`,
  `deepseek/deepseek-v4-pro` (the stronger model), and a broad `deny` followed
  by `read` / `glob` / `grep` / `external_directory` allows. The diff the
  reviewer reads is written outside the repo, hence the `external_directory`
  allow.

Model IDs are the ones configured in this OpenCode instance. The whole point of
the split (cheap coder, strong reviewer) only holds while the reviewer's model
is the stronger one; swap the `model:` lines when the available models change.

## Claimed paths

- `.opencode/agents/coder.md` (new)
- `.opencode/agents/reviewer.md` (new)
- `.opencode/agents/rules-checker.md` (new)
- `docs/agents/tasks/opencode-agents.md` (new)
- `docs/agents/roles.md`
- `docs/agents/repo-map.md`
- `docs/agents/task-board.md` (own claim block only)
- `docs/agents/workflow.md` (the review-gate mention only)

## Acceptance criteria

- [x] The three agent files exist under `.opencode/agents/` with `mode: subagent`.
- [x] `reviewer` and `rules-checker` cannot edit or run anything: a `deny` rule
      covers `*` before the read-only allows.
- [x] `coder` cannot spawn subagents.
- [x] The bodies are the `.claude/agents/` texts, unchanged in substance (the
      Claude-only preview-pane note is dropped from `coder`, since OpenCode has
      no preview pane).
- [x] `roles.md` names the OpenCode location; `repo-map.md` lists `.opencode/`.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (no code
      changed, so this is a no-regression check).

## Open questions

- Should the `feature` / `review-gate` skills move to `.opencode/skills/`? They
  already load from `.claude/skills/` in OpenCode, so this is left out. The
  human can decide later.
