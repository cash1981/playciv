# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### gift-greatperson-civ

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `feat/gift-greatperson-civ`
- **Brief:** `docs/agents/tasks/gift-greatperson-civ.md`
- **Status:** review-approved — implemented and checked on the branch; PR to
  open, awaiting the human's merge. Claim kept until merged.
- **Claimed paths:**
  - `packages/engine/src/item.ts` (`isTradable` comment only)
  - `packages/engine/src/actions/player.ts` (`tradeToPlayer` filter and comment only)
  - `packages/engine/package.json` (`@types/node` devDependency only)
  - `pnpm-lock.yaml`
  - `packages/engine/test/player-action.test.ts` (trade tests only)
  - `packages/engine/test/draw-action.test.ts` (a loot regression test only)
  - `packages/web/src/views/GameView.tsx` (`GiveControl` only)
  - `packages/web/src/views/GiveControl.test.tsx` (new)
  - `docs/agents/tasks/gift-greatperson-civ.md`
  - `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
- **Notes:** Corrected task. The human's report meant the Give control should
  NOT be offered on Great Person, Civ or City-state cards — only the old Java
  `Tradable` set (Culture I/II/III, Hut, Village) is giftable, and the engine
  already enforced that. The fix is client-side: `GiveControl` renders null for
  a non-Tradable item. An earlier pass on this branch wrongly enabled gifting
  Great Person and Civ; that is reverted (`isGiftable` removed, `tradeToPlayer`
  back to `isTradable`). Also declares `@types/node` on `packages/engine`,
  needed for `node:fs`/`node:url` in its tests.

### buymeacoffee-footer

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `feat/buymeacoffee-footer`
- **Brief:** `docs/agents/tasks/buymeacoffee-footer.md`
- **Status:** review-approved — implemented and self-checked on the branch; PR to
  open, awaiting the human's merge. Claim kept until merged.
- **Claimed paths:**
  - `packages/web/src/views/Footer.tsx`
  - `packages/web/src/views/Footer.test.tsx`
  - `packages/web/src/styles.css`
  - `docs/agents/tasks/buymeacoffee-footer.md`
  - `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
- **Notes:** Adds the human-supplied Buy Me a Coffee button next to the PayPal
  donate button in the site-wide footer (issue #77). New button only; the PayPal
  form and everything else in the footer is untouched.

### starting-tile-orientation

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `fix/starting-tile-orientation`
- **Brief:** `docs/agents/tasks/starting-tile-orientation.md`
- **Status:** done on the branch — implemented, all checks pass, and verified in
  a live 4-player and 2-player game in a browser. The human waived the review
  gate and tests it themselves. Claim kept until merged.
- **Claimed paths:**
  - `packages/engine/src/board.ts` (`startingCorner` and its comment only)
  - `packages/engine/test/board-tiles.test.ts`
  - `docs/agents/tasks/starting-tile-orientation.md`
  - `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`
- **Notes:** Fixes a 4-player (and every player count) bug where every starting
  tile faced outward. The raw artwork is uniform — all 16 starting tiles carry
  the arrow on the bottom edge pointing up — but `startingCorner` assumed the
  arrow points down, and its per-corner table was wrong on top of that. No image
  is touched. `board.ts` is also named in the (now merged) `culture-track-artwork`
  claim; PR #106 merged, so that claim is stale and the path is free.

### culture-track-artwork

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `feat/culture-track-artwork`
- **Brief:** `docs/agents/tasks/culture-track-artwork.md`
- **Status:** review-approved — implemented and checked on the branch; PR to
  open, awaiting the human's merge. Claim kept until merged.
- **Claimed paths:**
  - `packages/engine/src/board.ts`
  - `packages/engine/data/board-assets.json`
  - `packages/engine/test/culture-track.test.ts`
  - `packages/engine/test/board.test.ts` (comment only)
  - `packages/web/public/board/culture-track.png`
  - `tools/board-assets.ps1`
  - `docs/agents/tasks/culture-track-artwork.md`
  - `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`
- **Notes:** Replaces the wrong culture track with
  `Civilization/Moderator/map/culturetrack.png`. The new artwork is 2572 x 216
  and has 20 spaces, not 27. The human chose to follow the artwork (20 spaces)
  and keep today's band height, so `CULTURE_TRACK_SCALE` drops to 1.3.

### issue-92-admin-email-broadcast

- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Branch:** `feat/issue-92-admin-email-broadcast`
- **Brief:** `docs/agents/tasks/issue-92-admin-email-broadcast.md`
- **Status:** review-approved — implemented and checked on the branch; PR to
  open, awaiting the human's merge. Claim kept until merged.
- **Claimed paths:**
  - `packages/server/src/mail.ts`
  - `packages/server/src/markdown.ts` (new)
  - `packages/server/src/notifications.ts`
  - `packages/server/src/routes/admin.ts`
  - `packages/server/package.json`, `pnpm-lock.yaml` (`marked` only)
  - `packages/server/test/mail.test.ts`
  - `packages/server/test/admin-email-broadcast.test.ts` (new)
  - `packages/web/src/lib/api.ts` (`broadcastEmail` only)
  - `packages/web/src/views/AdminView.tsx`
  - `packages/web/src/views/AdminView.test.tsx` (new)
  - `docs/agents/tasks/issue-92-admin-email-broadcast.md`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
- **Notes:** Issue #92. Ports the old (unreachable) `GameAction.sendMailToAll`
  as an admin broadcast with a WYSIWYG Markdown editor, an editable subject and
  a checkbox to also mail players who unsubscribed. New server dependency
  `marked` renders the Markdown to an HTML email body. Sends run in-request, one
  per recipient, like the old method; see the brief for the volume caveat.

### games-list-tabs

- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Branch:** `feat/games-list-tabs`
- **Brief:** `docs/agents/tasks/games-list-tabs.md`
- **Status:** review-approved — Follow-up 2 (front-page layout and lobby chat) is
  folded in, reviewed with no defects, and all checks pass (418 engine, 162
  server, 65 web) after rebasing onto `main` (PR #99). PR #98 awaits the human's
  merge; the claim is kept until merged. The review gate ran with
  `deepseek/deepseek-v4-pro` as the reviewer because Sol (`gpt-5.6-sol`) is not
  available in this session and the human asked not to use Sol/Claude.
- **Claimed paths:**
  - `packages/engine/src/state.ts` (`GameState.createdAt` only)
  - `packages/engine/src/create-game.ts`, `packages/engine/src/migrate.ts`
  - `packages/engine/test/create-game.test.ts` (new)
  - `packages/server/src/routes/games.ts` (the two summary builders and the create handler only)
  - `packages/server/src/routes/public.ts` (the lobby chat route only)
  - `packages/server/test/api.test.ts` (a summary assertion only)
  - `packages/web/src/lib/api.ts` (game summary types only)
  - `packages/web/src/views/SortableTable.tsx`, `packages/web/src/views/Pager.tsx` (new), `packages/web/src/views/Tabs.tsx` (new)
  - `packages/web/src/views/HighscoreView.tsx`
  - `packages/web/src/views/GameList.tsx` (new), `packages/web/src/views/LobbyChat.tsx` (new), `packages/web/src/views/LandingView.tsx`
  - `packages/web/src/views/GameList.test.tsx` (new), `packages/web/src/views/SortableTable.test.tsx` (new), `packages/web/src/views/LobbyChat.test.tsx` (new)
  - `packages/web/src/styles.css`
  - `docs/agents/tasks/games-list-tabs.md`, `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`
- **Notes:** Ports old-civ-web's `list.html` split into "Active Games" and
  "Finished Games" tabs, with a sortable, paged table on both (reusing the
  front page's `SortableTable`/pager), plus the old search box and "Show my
  games". Ten rows per page. No GitHub issue — the human chose to implement
  directly. Adds `GameState.createdAt` so the old "Created" column has a
  source; migrated games get `null`.

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
| `packages/engine/data/board-assets.json` and `packages/web/public/board/` | `culture-track-artwork` (DeepSeek V4.1 Flash) |
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
