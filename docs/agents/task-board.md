# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

Recently done on `feat/game-fixes` (PR to open): core game bug fixes, tile
snap-on-move, duplicate start-player removal, zoom panning, tech-tree layout.

### issue-68-battle-fixes

- **Owner:** Claude (Sonnet 5)
- **Branch:** `fix/issue-63-arena-ux` (continuation of the still-open PR #67,
  per the human's request to fix issue #68 in the same branch)
- **Brief:** `docs/agents/tasks/issue-68-battle-fixes.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/web/src/views/GameView.tsx`
  - `packages/web/src/views/LogPanel.tsx`
  - `packages/web/src/views/ChatPanel.tsx` (new)
  - `packages/web/src/views/TechPanel.tsx`
  - `packages/web/src/views/RevealedPanel.tsx`
  - `packages/web/src/styles.css`
  - `packages/engine/src/actions/arena.ts`
  - `packages/engine/src/actions/game.ts`
  - `packages/engine/test/arena.test.ts`
  - `packages/engine/test/revealed-feed.test.ts`
  - `packages/server/test/api.test.ts`
- **Notes:** Seven fixes — see the brief. Rotate direction/stat-preview
  revises (not reverts) the issue-63 UX pass's "cosmetic only" rotate.

### revealed-panel

- **Owner:** Claude (Opus 4.8)
- **Branch:** `feat/issue-51-revealed`
- **Brief:** `docs/agents/tasks/revealed-panel.md`
- **Status:** in review (PR #59)
- **Claimed paths:**
  - `packages/engine/src/actions/game.ts` (adds `revealedFeed`)
  - `packages/engine/src/state.ts` (`RevealedEntry` type only)
  - `packages/engine/src/index.ts` (exports only)
  - `packages/server/src/routes/games.ts` (`/revealed` route only)
  - `packages/web/src/lib/api.ts` (`revealed` method only)
  - `packages/web/src/views/GameView.tsx` (removes Opponents panel, adds RevealedPanel)
  - `packages/web/src/views/RevealedPanel.tsx` (new)
  - `packages/web/src/styles.css` (a `discarded` tag if needed)
  - `packages/engine/test/revealed-feed.test.ts` (new)
  - `packages/server/test/api.test.ts`
  - `packages/web/src/views/RevealedPanel.test.tsx` (new)
- **Notes:** Issue #51. Replaces the Opponents panel with a chronological,
  server-paginated Revealed and Discarded Items feed. `opponents` data stays on
  `PlayerView` (still used by the turn banner, StatusPanel and the trade target
  dropdown) — only the visible panel goes.

### citystate-pieces

- **Owner:** Claude (Opus 4.8)
- **Branch:** `feat/citystate-pieces`
- **Status:** in review (PR #57)
- **Claimed paths:**
  - `packages/engine/src/board.ts` (`BoardAssetCategory` only)
  - `packages/engine/data/board-assets.json` and `packages/web/public/board/`
  - `tools/board-assets.ps1`
  - `packages/web/src/views/BoardView.tsx` (palette category only)
  - `packages/engine/test/board.test.ts`
- **Notes:** Adds a `citystate` board-asset category (the five neutral
  city-states cs1–cs5, art from `Civilization/Moderator/city-states`, capped to
  one square) so city-states can be placed on the map from the palette like
  cities. (culture-free-move merged as PR #53, wonders-board as PR #52.)

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
| `packages/engine/src/state.ts` (`PlayerView` shape) | free |
| `packages/web/src/lib/api.ts` | free |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

| Slug | What | Brief |
| --- | --- | --- |
| `public-landing` | Landing page: active games, highscore, open chat | `tasks/public-landing.md` |
| `anonymous-readonly` | Read-only access without an account, and the security pass that goes with it | `tasks/anonymous-readonly.md` |
