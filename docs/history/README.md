# Historical documentation

Historical plans are not current requirements. Use this guide only to answer
an explicit question about why behavior changed or what a retired brief said.
Current orientation is in [state](../agents/state.md), current rationale in
[decisions](../agents/decisions.md), and known gaps in
[limitations](../agents/limitations.md).

## Retrieve the pre-cleanup documents

The documentation audit used main at
`8eecce4142d13cdc35ec828f7027eb0bce86a192` (2026-10-09). All 140 feature briefs,
the 1,591-line state ledger and the 4,770-line decision log remain in Git:

```bash
# List the old briefs without reading them all.
git ls-tree --name-only 8eecce4142d13cdc35ec828f7027eb0bce86a192:docs/agents/tasks
# Read only the relevant brief or old decision topic.
git show 8eecce4142d13cdc35ec828f7027eb0bce86a192:docs/agents/tasks/single-chat.md
git show 8eecce4142d13cdc35ec828f7027eb0bce86a192:docs/agents/decisions.md
# Follow the implementation/removal history for a relevant path.
git log --oneline --all -- packages/engine/src/actions/arena.ts
```

In a shallow clone, fetch the relevant history when authorized and available,
or use the [pre-cleanup documentation on GitHub](https://github.com/cash1981/playciv/tree/8eecce4142d13cdc35ec828f7027eb0bce86a192/docs/agents).

## Why the old plans were retired

All feature briefs and the full state/decision logs were reviewed against Git
history, with current-code checks for potentially pending or superseded work.
No historical brief was identified as an active unfinished feature. Stale
statuses and unchecked verification boxes were not treated as a work queue.
Unique compatibility constraints and outstanding limitations were retained in
the current references. Examples of superseded plans:

| Historical instruction | Current outcome |
| --- | --- |
| Keep classic TurnPanel and a chat-mode switch | Timeline only; old panels/actions removed. |
| Add an admin tool to migrate old chat | Migration completed; tool removed; save compatibility retained. |
| Use Mongo/Render and follow Java as specification | Worker/D1 and current code/tests. |
| Two-player map is 8×8 | 16×8. |
| Automatically discard arena kills; prohibit standalone barbarian draws | Reversible kill flags; independent barbarian draws supported. |
| Keep Military Tradition → Patronage | Corrected to Pacifism. |
| Expose placed Great Person names | Public placement slots only. |
| Internet needs the shared Wonders area; metropolis unsupported | Position-independent owned-wonder bonuses and metropolis outskirts supported. |

The old state ledger duplicated README, decisions, briefs and PR results.
It was removed rather than copied into another large mandatory document.
Eleven brief paths still cited by source/tests/generated metadata remain as
short **historical redirects**; they contain no implementation instructions.
