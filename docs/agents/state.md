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
  of decisions and `tasks/assisted-*.md`. Free-text trade offers (#265, #274) are
  built too; see "Trade offers (#265)" in decisions.

- Phase tabs and Start of Turn (part 13) are on PR #271: the Your actions panel has a tab per
  phase, each with a "Possible actions" box (Advance culture scrolls to Your hand afterwards),
  cards play from the tabs and the hand as log lines, and Start of Turn has buttons for
  policies, governments, investing, founding cities from scouts, scout squares, and wonder,
  Great Person, tech, hut and relic abilities. Brief `tasks/assisted-sot.md`; see "Phase tabs
  and Start of Turn" in decisions for what the human settled and what is still a judgement.

- The action panel shows only ready or used actions for the open phase; button reasons
  are behind `?`, playable card names link to the card in the hand and tech actions to
  the tech panel, and Invest is hidden without a coin. See "Action panel focus" in
  decisions.

- City production (#250 slice A, first part of #264) is on PR #271: a per-city
  estimate with a hand-set override, shown on each city card.
  Brief `tasks/city-production.md`; see "City production" in decisions.

- Assisted build (#264) is on PR #271: a Build button per city for buildings, army and
  scout figures and military units, legal choices only, square picking on the board, trade
  rush, undo by vote; also Start Building Program and Upgrade buildings. Devote to the Arts and
  Harvest read the resource and culture icons from `engine/data/tile-icons.json` (read by eye from
  the tile images; see "Devote to the Arts and Harvest" in decisions). Briefs
  `tasks/assisted-build.md`, `tasks/assisted-units.md`, `tasks/assisted-city-actions.md` and `tasks/assisted-gather.md`;
  see "Assisted build" in decisions.

- The game header names the player furthest behind as the one who is up and lists
  only the earliest open phase under "Waiting for"; the shortcuts are Board, Actions,
  Your cards and Tech tree; a city's arithmetic opens in a popup. Brief
  `tasks/phase-cities-polish.md`; see "Assisted play" in decisions.

- The viewer's own cities (cards, Build, Start Building Program, Upgrades, production) are in the
  City Management tab of "Your actions", under the board. There is no panel for the opponents'
  cities. See "Assisted play" in decisions.

- Build: a button per group (buildings, wonders, figures, units), placed by the tap on a square;
  removing the piece before End turn takes the build back. See "Build polish and wonders" in decisions.

- End turn (it ends the viewer's open phase) is a button in "Your actions"; the Order tab keeps
  its own for now. See "Assisted play" in decisions.

Read [current decisions](decisions.md) for the relevant compatibility/rationale
and [limitations](limitations.md) for known gaps. Archived Mongo games remaining
nonplayable is separate from the completed single-chat migration.

## Documentation lifecycle

Completed task history lives in Git, with retrieval instructions in
[the history guide](../history/README.md). Historical briefs and old decision
entries must not be treated as active requirements or automatically loaded.
