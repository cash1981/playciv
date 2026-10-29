# Historical documentation

Retired plans are not current requirements. Use Git history only to answer an
explicit question about why behavior changed. Current orientation is in
[state](../agents/state.md), rationale in [decisions](../agents/decisions.md)
and known gaps in [limitations](../agents/limitations.md).

```bash
# Every brief that ever existed, and the commit that deleted it.
git log --diff-filter=D --name-only --oneline -- docs/agents/tasks
# Read one retired brief (use the parent of the deleting commit).
git show <commit>^:docs/agents/tasks/<slug>.md
# Follow a source path's history.
git log --oneline -- packages/engine/src/actions/arena.ts
```

Two snapshots hold most of the history:

- `8eecce4` (2026-10-09): the 140 original briefs, the old state ledger and the
  4,770-line decision log.
- The parent of the `chore/docs-cleanup` merge (2026-10-29): the 45 briefs of
  the assisted-play, trade, Great Person and figure-movement work (#260–#309).

In a shallow clone, fetch history first or browse
[the 2026-10-09 snapshot on GitHub](https://github.com/cash1981/playciv/tree/8eecce4142d13cdc35ec828f7027eb0bce86a192/docs/agents).
