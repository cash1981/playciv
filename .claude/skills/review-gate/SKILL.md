---
name: review-gate
description: Run the review cycle on the current feature branch — verify, hand the diff to a read-only reviewer on a stronger model, and decide whether to approve. Use when a coder reports done, before opening a pull request, or whenever the human asks for the work to be checked. Nothing merges without passing this.
---

# Review gate

Follow the review gate in `docs/agents/workflow.md` and reviewer boundaries in
`docs/agents/roles.md`. Run it after the first implementation, then repeat after
fixes until nothing above a nit remains. Record any accepted nit. The
orchestrator approves based on evidence; the implementer does not self-review.

Run the required typecheck, tests and build in the actual environment. Resolve
failures before the gate. Give the read-only reviewer the complete proposed
diff (including uncommitted changes), the active brief, actual check output and
previous findings. Store any diff file outside the checkout. Split a large diff
by area so every part is reviewed.

When the Agent tool is available, invoke `subagent_type: "reviewer"` using
`.claude/agents/reviewer.md`. Its tool list deliberately permits only reading.
If this host cannot invoke that reviewer, report the missing capability.

Check each finding against the code, have the implementer fix confirmed issues,
and review the updated diff again. After three unsuccessful rounds, escalate
the implementation to a stronger available model rather than repeating the same
approach. Do not silently change configured reviewer models or permissions.

Never approve an untested hidden-information leak, an invented rule, a hidden
behavior change, weakened tests used to conceal failure, or an impure engine
reducer. Keep durable rationale in current decisions, not an append-only review
transcript; report unavailable verification explicitly.
