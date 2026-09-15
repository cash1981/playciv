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

What the Java source or the AngularJS client did here, and where to find it.
`old-civ-rest/src/main/java/...`, `old-civ-web/app/...`. If there is no
reference — the feature is new — say so plainly, because that is the signal to
ask the human rather than invent.

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

Anything needing the human. **If a question would change the work materially,
ask before starting**, do not guess and carry on.
