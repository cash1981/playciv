# CLAUDE.md

The shared instructions live in `AGENTS.md` so that Claude and Codex read the
same thing. It is imported below; everything in it applies.

@AGENTS.md

## Claude-specific notes

**Subagents.** The roles in `docs/agents/roles.md` are wired up as agent
definitions in `.claude/agents/`. Spawn them with the Agent tool using the
`subagent_type` that matches the file name:

- `coder` — writes code, on a cheaper model
- `reviewer` — checks the work, on a stronger model, **read-only**
- `rules-checker` — checks a change against the Java reference, **read-only**

Reviewers have no Write, Edit or Bash tool. That is deliberate: a reviewer that
can edit will fix what it finds instead of reporting it, and the orchestrator
loses the chance to approve. Give them a diff to read; see the `review-gate`
skill.

**Skills.** Two slash commands automate the loop:

- `/feature` — start, resume or finish a feature branch and its task claim
- `/review-gate` — run the coder → reviewer → approval cycle on the current diff

**Shell.** Windows. The Bash tool is Git Bash, the PowerShell tool is pwsh; they
take different syntax. Node and pnpm are not on the default PATH — prepend
`C:\Program Files\nodejs` before running them from PowerShell.

**Do not** use the Workflow tool or background fleets unless the human asks.
The point of this setup is a small, predictable number of agents.
