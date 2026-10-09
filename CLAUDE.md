# CLAUDE.md

@AGENTS.md

Shared workflow and role definitions live in `docs/agents/workflow.md` and
`docs/agents/roles.md`. Read only the documents needed for the current task.

Claude adapters are in `.claude/agents/`: `coder` implements assigned work;
`reviewer` reviews with Read/Glob/Grep only, without Write/Edit/Bash. When the
Agent tool is available, use the matching `subagent_type`. Give reviewers the
diff and verification evidence described by `/review-gate`.

`/feature` follows the shared task lifecycle; `/review-gate` runs independent
review. Use the session's actual shell, PATH and browser capabilities. Do not
use the Workflow tool or background fleets unless the human asks.
