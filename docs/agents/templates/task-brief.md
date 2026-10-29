# <Title>

- **Slug:** `<slug>` · **Branch:** `feat/<slug>` · **Owner:** <who> · **Status:** draft

## Goal

What should be true when this is done, from the player's side. If the human
asked in particular words, quote them; the wording often carries a constraint.

## Scope

**In:** …

**Out:** … and why.

## Reference

Relevant decision topic, source, tests and rulebook section. State unresolved
rules; do not invent them.

## Approach

Packages, files and new state, in enough detail for a reviewer to compare.

## Claimed paths

- `packages/…`

## Acceptance criteria

- [ ] …
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: <what must not leak, and the test that proves it>
- [ ] Browser check: <what was looked at and seen>

## Open questions

Only blocking unknowns. Delete this brief in the branch's last commit, after
review approves (see `tasks/README.md`).
