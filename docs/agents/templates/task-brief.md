# <Title>

- **Slug:** `<slug>`
- **Branch:** `feat/<slug>`
- **Owner:** <who>
- **Status:** draft

## Goal

One paragraph. What should be true when this is done that is not true now,
described from the player's side rather than the code's.

## Why

What this is for, and what it unblocks. If the human asked for it in a
particular way, quote them — the exact wording usually carries a constraint.

## Scope

**In:**

- …

**Out:**

- … and why it is out. "Deferred" with no reason is how scope creeps back in.

## Reference

What the current code, the rulebooks or an earlier decision say about this.
Link the relevant current decision topic, source/tests and rulebook section.
Do not load retired briefs by default. State genuinely unresolved rules or
requirements; an already authorized feature does not need another approval.

## Approach

The shape of the change. Which packages, which files, what new state if any.
Enough that a reviewer can tell whether the result matches the plan; not so
much that it is the code written twice.

## Claimed paths

- `packages/…`

## Acceptance criteria

Checkable statements. The reviewer reads these.

- [ ] …
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: <what must not leak, and the test that proves it>
- [ ] Verified in the browser: <what was looked at, and what was seen>

## Open questions

List genuinely blocking unknown requirements; continue independent work while
asking for the missing information. Do not invent rules.

## Handover

Record actual validation and remaining limits for the open PR. After merge,
retain durable rationale in current decisions and retire this brief in a
subsequent change; see `tasks/README.md`.
