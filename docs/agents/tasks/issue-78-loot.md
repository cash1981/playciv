# Loot controls

- **Slug:** `issue-78-loot`
- **Branch:** `feat/issue-78-loot`
- **Owner:** Codex
- **Status:** in progress

## Goal

A player can use the game UI to transfer a random lootable item from their own
hand to a selected opponent, with the same categories, randomness and logs as
the old application.

## Why

GitHub issue #78 says: "After battle, you should be able to loot. This is needs
to be implemented." The engine, server route and web API method were partly
ported already, but the current UI exposes no way to use them and the current
route cannot express the old combined Culture Card category.

## Scope

**In:**

- Add loot controls to the player's hand area, where the old client exposed
  them under My Items.
- Offer exactly the old categories: Culture Card, Huts and Villages.
- Treat Culture Card as one random pool containing Culture I, II and III.
- Let the current player select the opponent who receives the random item.
- Preserve the old reducer behaviour and public/private loot logs.

**Out:**

- Battle-result integration, winner validation, loot entitlement/counts or
  timing restrictions. The old system did not implement any of these.
- Automatic loot resolution. The old client required the player losing the
  item to initiate the action manually.
- Per-card loot actions. The item is random within the chosen old category.

## Reference

- `old-civ-rest/src/main/java/no/asgari/civilization/server/SheetName.java`:
  `CULTURE_CARD` is exactly Culture I, II and III.
- `old-civ-rest/src/main/java/no/asgari/civilization/server/resource/DrawResource.java`:
  the literal `Culture Card` maps to the combined set; other valid sheet names
  map to a single-element set.
- `old-civ-rest/src/main/java/no/asgari/civilization/server/action/DrawAction.java`:
  filters the acting player's hand, shuffles the candidates, transfers the
  first item and writes private/public logs for both players.
- `old-civ-web/app/views/partials/useritems.html` and
  `old-civ-web/app/scripts/controllers/UserItemController.js`: one Loot button
  each for Culture Card, Huts and Villages in My Items; a modal selects the
  receiving player.

## Approach

Keep the pure engine `loot` reducer and its set-based input. Introduce a narrow
loot-category type at the HTTP/client boundary so the server can map Culture
Card to all three culture sheets while Huts and Villages remain separate.
Render a compact loot control in `HandPanel`, only for categories present in
the player's own hand, with an opponent selector and explicit action button.
Add focused engine, server and component tests.

## Claimed paths

- `docs/agents/tasks/issue-78-loot.md`
- `docs/agents/task-board.md`
- `packages/engine/src/actions/draw.ts`
- `packages/engine/test/draw-action.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/LootControls.test.tsx`
- `docs/agents/state.md`
- `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Hand UI offers Culture Card, Huts and Villages loot only when the player
      holds at least one item in that category.
- [ ] The player selects an opponent and deliberately starts the loot action.
- [ ] Culture Card randomly selects across Culture I, II and III as one pool.
- [ ] Huts and Villages each select from only their matching sheet.
- [ ] The transferred item is removed from the acting player's hand, added to
      the selected opponent's hand, and uses the existing old-system log text.
- [ ] No battle timing, winner or loot-count rules are added.
- [ ] Tests cover the combined culture pool, the HTTP mapping and the UI.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: loot controls derive only from the viewer's own full
      hand and opaque opponent identities; existing projection guarantees stay
      unchanged.
- [ ] Verified in the browser: category visibility, opponent selection and the
      resulting hand/log update are observed.

## Open questions

None. The old backend, client and tests settle the category behaviour.
