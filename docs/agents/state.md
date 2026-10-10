# Current state

Current orientation, not a release history. Keep this under 80 lines and read
only the reference sections relevant to the task. Check the current revision;
old test counts and past deployment reports do not establish present health.

## Development

- Four workspace packages: pure engine, Hono server, React/Vite web and Worker.
- Node >=24 and the pnpm version pinned in root `package.json` (11.24.0 at this
  cleanup). `.node-version` still says 22; follow the manifest requirement.
- Local development uses Node and JSON-file storage. Production uses a
  Cloudflare Worker and D1. See [repo-map.md](repo-map.md) for entry points.
- Run `pnpm -r typecheck && pnpm -r test && pnpm -r build` from the root.
- Active work and path ownership belong in [task-board.md](task-board.md).

## Current behavior and compatibility

- Every game uses the chat/orders timeline. The classic Turn orders panel,
  mode switch and admin chat-migration tool are removed.
- Classic saves still need load-time adoption and the compatibility flags
  `legacyOrdersCopied` / `legacyRevealsCopied`.
- Public views filter hidden information. See limitations for active-game
  spectator board controls and the current game-chat posting permissions.
- Revisions use keyframes and deltas; supported cleanup/compaction preserves
  chains. Do not manually remove revision rows.
- Standalone barbarian drawing and Undo End battle are implemented.
- Email notifications, broadcast queues and idle-turn reminders are implemented.
  Verify configuration/migrations in the target environment before deployment;
  repository history does not establish whether production is up to date.

- Assisted play (#260) is on PR #271: card buttons, culture advance, Great Person
  markers, phase summary, confirm before reuse. See the "Assisted play" section
  of decisions and `tasks/assisted-*.md`. Offers (#265) are not built.

- City production (#250 slice A, first part of #264) is on PR #271: a per-city
  estimate with a hand-set override and a Cities panel.
  Brief `tasks/city-production.md`; see "City production" in decisions. The Build
  button, figures, units and other city actions are the next parts.

- Assisted build (#264) is on `feat/assisted-build` (buildings) and
  `feat/assisted-units` (army and scout figures, military units; includes the first
  branch), not yet in PR #271: a Build button per city, legal choices only, square
  picking on the board, trade rush, undo by vote. `feat/assisted-city-actions` (includes
  both) adds Start Building Program and Upgrade buildings. Harvest and devote to the arts
  are not built (their icon data is not in the map data). Briefs `tasks/assisted-build.md`,
  `tasks/assisted-units.md` and `tasks/assisted-city-actions.md`; see "Assisted build" in decisions.

Read [current decisions](decisions.md) for the relevant compatibility/rationale
and [limitations](limitations.md) for known gaps. Archived Mongo games remaining
nonplayable is separate from the completed single-chat migration.

## Documentation lifecycle

Completed task history lives in Git, with retrieval instructions in
[the history guide](../history/README.md). Historical briefs and old decision
entries must not be treated as active requirements or automatically loaded.
