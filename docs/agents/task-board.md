# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### coin-tab

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `feat/coin-tab`
- **Brief:** `docs/agents/tasks/coin-tab.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/coins.ts` (new)
  - `packages/engine/src/state.ts` (`PlayerStats`, `DEFAULT_PLAYER_STATS`)
  - `packages/engine/src/actions/player.ts` (`STAT_KEYS`, `STAT_LABEL`, `setPlayerStat`, `setCoinSource`)
  - `packages/engine/src/errors.ts`, `packages/engine/src/index.ts`, `packages/engine/src/migrate.ts`
  - `packages/engine/test/player-stats.test.ts`, `packages/engine/test/coin-sources.test.ts` (new)
  - `packages/server/src/routes/play.ts` (the new coin route only)
  - `packages/server/src/errors.ts`, `packages/server/test/api.test.ts`
  - `packages/web/src/lib/api.ts` (`setPlayerCoin` only)
  - `packages/web/src/views/StatusPanel.tsx`, `packages/web/src/views/StatusPanel.test.tsx`
  - `packages/web/src/views/PlayerTabs.tsx` (doc comment only)
  - `packages/web/src/styles.css`
  - `docs/agents/tasks/coin-tab.md`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
- **Notes:** The new **Coins** tab in Player status: one counter per coin source
  per player, capped at 4 / 1, unlimited for Sheet and Panama Canal, and a
  read-only total in the status table. The Internet is deferred to issue #145.
  This claim also releases `issue-140-tech-policy-tabs` (PR #143 merged; checked
  with `gh pr view 143`).

---

## Format

Copy this block, fill it in, put it under "Live claims".

```markdown
### <slug>

- **Owner:** <agent or person> (<model>)
- **Branch:** `feat/<slug>`
- **Brief:** `docs/agents/tasks/<slug>.md`
- **Status:** claimed
- **Claimed paths:**
  - `packages/engine/src/...`
  - `packages/web/src/views/...`
- **Notes:** anything another agent needs to know to stay out of the way
```

---

## Shared resources

These are rewritten wholesale rather than edited, so only one task may own each
at a time. Claim them by name.

| Resource | Owned by |
| --- | --- |
| `packages/engine/data/board-assets.json` and `packages/web/public/board/` | free |
| `packages/web/public/items/` | free |
| `packages/engine/data/gamedata-faf-waw.json` | free |
| `packages/engine/src/state.ts` (`PlayerView` shape) | `coin-tab` (DeepSeek V4.1 Flash) |
| `packages/web/src/lib/api.ts` | `coin-tab` (DeepSeek V4.1 Flash) |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
