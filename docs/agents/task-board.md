# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### turn-order-reveal

- **Owner:** Codex (human approved overlap with stale claims)
- **Branch:** `fix/turn-order-reveal`
- **Brief:** `docs/agents/tasks/turn-order-reveal.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/turn.ts`
  - `packages/engine/src/actions/turn.ts`
  - `packages/engine/src/migrate.ts`
  - `packages/engine/test/turn-action.test.ts`
  - `packages/server/src/routes/play.ts`
  - `packages/server/test/api.test.ts`
  - `packages/web/src/lib/api.ts`
  - `packages/web/src/views/TurnPanel.tsx`
  - `packages/web/src/views/TurnPanel.test.tsx`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`

### issue-40-signup-security-question

- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Branch:** `feat/issue-40-signup-security-question`
- **Brief:** `docs/agents/tasks/issue-40-signup-security-question.md`
- **Status:** review-approved — implemented and checked on the branch; PR to
  open, awaiting the human's merge. Claim kept until merged.
- **Claimed paths:**
  - `packages/server/src/auth.ts` (`isSecurityAnswer` only)
  - `packages/server/src/routes/auth.ts` (the register handler only)
  - `packages/server/test/auth-register.test.ts` (new)
  - `packages/server/test/api.test.ts`
  - `packages/server/test/admin-user.test.ts`
  - `packages/server/test/board-api.test.ts`
  - `packages/server/test/notifications.test.ts`
  - `packages/server/test/auth-password-reset.test.ts`
  - `packages/web/src/lib/api.ts` (`register` only)
  - `packages/web/src/views/LoginView.tsx`
  - `packages/web/src/views/LoginView.test.tsx`
  - `docs/agents/tasks/issue-40-signup-security-question.md`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
- **Notes:** Issue #40. The human chose the old fixed question
  ("What is China's starting tech?" / "writing", case-insensitive) enforced on
  both client and server. The old gate was client-only; server enforcement is a
  deliberate improvement recorded in `decisions.md` and `README.md`. The
  claimed test files are only touched to add `securityAnswer: 'writing'` to
  existing registration payloads.

### issue-37-password-reset

- **Owner:** orchestrator (DeepSeek V4.1 Flash); verification by a second agent
- **Branch:** `feat/issue-37-password-reset`
- **Brief:** `docs/agents/tasks/issue-37-password-reset.md`
- **Status:** in review — implemented and pushed, awaiting the second agent's
  verification and the human's merge.
- **Claimed paths:**
  - `packages/server/src/auth.ts`
  - `packages/server/src/routes/auth.ts`
  - `packages/server/test/auth-password-reset.test.ts` (new)
  - `packages/web/src/views/LoginView.tsx`
  - `packages/web/src/views/LoginView.test.tsx` (new)
  - `packages/web/src/lib/api.ts`
  - `docs/agents/tasks/issue-37-password-reset.md`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
- **Notes:** Issue #37. Owner approved a signed, expiring reset-token link: the
  email carries a HMAC-signed payload (player id + hashed new password + expiry);
  nothing is stored server-side. The weak old `verify/{playerId}` link is not
  ported, and no `Repository` change is needed, so this does not collide with the
  D1 branch (#72).

Recently done on `feat/game-fixes` (PR to open): core game bug fixes, tile
snap-on-move, duplicate start-player removal, zoom panning, tech-tree layout.

### issue-43-social-policy-and-worktree-follow-up

- **Owner:** Codex
- **Branch:** `feat/issue-43-governments`
- **Brief:** `docs/agents/tasks/issue-43-governments.md`
- **Status:** done
- **Claimed paths:**
  - `docs/agents/task-board.md`
  - `docs/agents/tasks/issue-43-governments.md`
  - `docs/agents/workflow.md`
  - `.agents/skills/feature/SKILL.md`
  - `docs/agents/state.md`
  - `packages/web/src/views/TechPanel.tsx`
  - `packages/web/src/views/TechPanel.test.tsx`
  - `packages/web/src/styles.css`
  - `packages/web/public/governments/`
- **Notes:** Social Policy is discoverable in the open Techs panel; Government
  cards open from a `?` help button in an accessible modal; worktree cleanup
  instructions preserve the feature branch.

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
