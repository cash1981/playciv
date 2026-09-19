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

### issue-77-footer

- **Owner:** OpenCode (DeepSeek V4.1 Flash)
- **Branch:** `feat/issue-77-footer`
- **Brief:** `docs/agents/tasks/issue-77-footer.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/web/src/App.tsx`
  - `packages/web/src/views/Footer.tsx` (new)
  - `packages/web/src/views/Footer.test.tsx` (new)
  - `packages/web/src/styles.css`
  - `docs/agents/tasks/issue-77-footer.md` (new)
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`
  - `docs/agents/decisions.md`
  - `README.md`
- **Notes:** Issue #77. Adds the old footer (copyright, Apache 2.0 link, PayPal
  donate button) to every page; Patreon is dropped per the human. `styles.css`
  overlaps a stale `revealed-panel` claim whose PR #59 is already merged.

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

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
