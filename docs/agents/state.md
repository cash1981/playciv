# Current state

Orientation, not a release history. Keep it under 60 lines. Old test counts and
deployment reports do not establish present health.

## Development

- Four workspace packages: pure engine, Hono server, React/Vite web and Worker;
  see [repo-map.md](repo-map.md).
- Node >=24 and the pnpm version pinned in root `package.json`. `.node-version`
  still says 22; follow the manifest.
- Local development uses Node and JSON-file storage; production uses a
  Cloudflare Worker and D1.
- Verify with `pnpm -r typecheck && pnpm -r test && pnpm -r build` from the root.

## Current behavior

- Every game uses the chat/orders timeline. Classic saves are adopted on load
  (`legacyOrdersCopied` / `legacyRevealsCopied`); archived Mongo games are not
  playable.
- Public views filter hidden information. Spectators get a read-only board,
  Battle panel and Social policy panel.
- Revisions use keyframes and deltas; only the supported cleanup/compaction may
  remove rows.
- Email notifications, broadcast queues and idle-turn reminders exist. Check the
  target environment's configuration and migrations before deploying.
- Assisted play (#260, #264): "Your actions" has a tab per phase with possible
  actions, playable cards, Start of Turn abilities, Research (with the tech tree)
  and City Management (city cards, production estimate, Build, Start Building
  Program, Upgrades, Devote to the Arts and Harvest). End turn ends the viewer's
  open phase. Used policies and wonders are disabled; a repeat of a Great Person
  or culture card asks first.
- Great Person automation: Archimedes, Shakespeare, Pasteur, Michelangelo,
  Edison, Mother Teresa, Marie Curie, Cook, Ford, Frank Lloyd Wright and Einstein
  apply through the engine.
- Trade: free-text trade offers (#265); trade resets to coins at turn start for
  a player who researched, and city trade is collected once when Trade starts.
- Figure movement (#302): enforced speed, water, stacking and stops; movement is
  a pool shared with exploring; card map picker for Galileo, Steam Power,
  Hannibal and movement culture cards; Communism and Brandenburg Gate.
  Disbanding on an own city centre leaves a caravan or fortification (F&F), and
  a battle for a city counts its defence bonus. Battle resolution, loot and
  removal stay manual by the human's choice.

The matching topics in [decisions.md](decisions.md) give the rules and
reasons; [limitations.md](limitations.md) lists known gaps.
