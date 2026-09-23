# Player tabs for techs and social policy

- **Slug:** `issue-140-tech-policy-tabs`
- **Branch:** `feat/issue-140-tech-policy-tabs`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress
- **GitHub:** https://github.com/cash1981/playciv/issues/140

## Goal

The game page gets two separate collapsible panels — **Techs** and **Social
policy** — instead of one combined panel. Each shows exactly one player's data
at a time, behind a tab bar: the viewer's own username first, then one tab per
opponent, each labelled with the username and accented with that player's board
colour (the turn-order-tab convention). The viewer's own tab keeps today's
controls (choose, reveal, remove, hidden badges); every other player's tab shows
only what that player has chosen to reveal — hidden techs and hidden social
policies never leave their owner's view. Other players' social policies are
visible in a tab for the first time.

## Why

Issue #140, quoted exactly:

> Like the Tech implementation, you should be able to see other players social
> policies.
>
> ![screenshot of the current Techs & Social policy panel](https://github.com/user-attachments/assets/1bf24ac2-01c7-4beb-8768-1d429cbef1e1)
>
> Create it on its own section, so extract it out from inside tech, create tabs
> for each player so you can switch to see what they have.
> Also create a tab for each player to show their techs too and not below yours
> as today.

Today `TechPanel` stacks the viewer's pyramid, every opponent's pyramid and the
whole social-policy section in one panel. The human answered the three layout
questions before work started: own data is the first tab in both panels; tabs
are labelled with the username and player colour; the pickers stay at the top of
each panel, above the tabs.

## Reference

- **Techs.** `revealedTechsForAllPlayers` (`packages/engine/src/actions/player.ts`)
  is the port of Java `PlayerAction.getTechsForAllPlayers` and
  `PlayerResource./tech/all`: other players' non-hidden techs only, one entry per
  player with a civilization. The old client rendered that list
  (`old-civ-web/app/scripts/controllers/TechController.js`); there is no old
  screen with player tabs to copy, so the tab shape is the human's design, not a
  port.
- **Social policies.** Java has no public per-player projection and no reveal at
  all: `SocialPolicy` is a `hidden = true` hand item and
  `PlayerAction.chooseSocialPolicy` only writes it. The in-repo
  `revealSocialPolicy` is the port-only feature the human asked for earlier
  (`decisions.md`, 2026-09-16, and the issue #6 brief). This change exposes the
  revealed half of it, exactly as techs are exposed; it invents no rule.
- **Tabs.** `TurnTabs` in `TurnPanel.tsx` + `TurnPanel.css` is the look to
  reuse: username, `--turn-tab-color` accent, `role="tablist"`, arrow/Home/End
  keyboard navigation. `TurnPanel` is not rewritten.

## Approach

**Engine — `packages/engine/src/state.ts` only**

- `OpaquePlayerhand` gains
  `readonly revealedSocialPolicies: readonly SocialPolicyItem[]`, populated in
  `opaque()` as `player.socialPolicies.filter((policy) => !policy.hidden)` —
  the exact mirror of `revealedTechs` a few lines above it. The existing
  `numberOfSocialPolicies` count stays public.
- No new route, DTO or reducer. `toPlayerView` already feeds every read route
  and the revision replay, so both panels get per-player data — live and
  historical — from `view.you` / `view.opponents`. A new route would duplicate
  data the client already holds, and one source keeps the two panels from
  drifting.
- `POST /api/games/:id/socialpolicies/reveal`,
  `revealedTechsForAllPlayers` and `GET /techs/revealed` are untouched; the
  panel simply stops calling the last one because the projection now carries
  the same data keyed by player.

**Web**

- New `PlayerTabs.tsx` + `PlayerTabs.css`: one coloured tab bar shared by both
  panels (`tabs: { key, label, color }[]`, `active`, `onSelect`, `aria-label`),
  with the keyboard handling copied from `TurnTabs`.
- `TechPanel.tsx` becomes techs only. The choose-a-tech picker and Research
  button stay at the top; below them the tabs. Own tab: the pyramid, the
  hidden-tech list with Reveal/Remove and today's empty states. Opponent tab:
  `opponent.revealedTechs` as a pyramid, muted when empty.
- New `SocialPolicyPanel.tsx` + test. The choose-a-card picker, the
  unavailable-policy message and the `?` reference stay at the top (unchanged,
  still visible to a spectator). Own tab: chosen cards with flipside, the
  hidden/revealed tag and Reveal/Remove. Opponent tab:
  `opponent.revealedSocialPolicies` as cards, muted when empty. The catalogue
  still comes from `api.socialPolicies`; the engine's own directional
  flipside rule and the greying-out logic move with the picker.
- `GameView.tsx` renders `<SocialPolicyPanel …/>` directly after
  `<TechPanel …/>` with the same props.
- Tabs: `view.you` first when present, then `view.opponents` in their existing
  order; key is `playerId`; colour from `color`. A spectator sees every player
  and no own tab. Every player gets a tab even with nothing revealed, per the
  issue ("a tab for each player"); no civilization is required.

**Out of scope**

- Rewriting `TurnPanel` onto `PlayerTabs` — it works and is styled for its own
  section; touching it would widen the diff for no user-visible gain.
- A `/socialpolicies/revealed` route or an engine
  `revealedSocialPoliciesForAllPlayers` function: the projection already gives
  each viewer exactly the revealed set keyed by player, and a second path could
  disagree with it.
- Enforcing social-policy card effects; the engine still records without
  applying, as before.

## Claimed paths

- `packages/engine/src/state.ts` (`OpaquePlayerhand` and `opaque()` only)
- `packages/engine/test/hidden-info.test.ts` (the social-policy projection test)
- `packages/web/src/views/PlayerTabs.tsx` (new)
- `packages/web/src/views/PlayerTabs.css` (new)
- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/TechPanel.test.tsx`
- `packages/web/src/views/SocialPolicyPanel.tsx` (new)
- `packages/web/src/views/SocialPolicyPanel.test.tsx` (new)
- `packages/web/src/views/GameView.tsx` (the panel list only)
- `docs/agents/tasks/issue-140-tech-policy-tabs.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`

No `packages/web/src/lib/api.ts` change: the panel reads the data off the
`PlayerView` it already receives.

## Acceptance criteria

- [ ] A hidden social policy stays out of another player's view;
      `opponent.revealedSocialPolicies` contains it only after
      `revealSocialPolicy`, and the serialised opponent never contains the
      hidden name. `hidden-info.test.ts`, extending the existing social-policy
      test.
- [ ] Techs render as one panel with a tab per player: own pyramid and
      Reveal/Remove list on the first tab, each opponent's revealed pyramid on
      theirs, nothing stacked below. Web tests.
- [ ] Social policy renders as its own panel with a tab per player: own cards
      with Reveal/Remove, each opponent's revealed cards read-only, muted empty
      states. Web tests.
- [ ] Tab labels are usernames, carry the player colour, and keyboard arrow
      navigation moves between them (ARIA `tab`/`tablist`).
- [ ] A spectator with no `you` sees a tab per player and no own tab; the
      pickers and the `?` reference stay usable.
- [ ] The social-policy picker's directional flipside greying is unchanged and
      still tested.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: both panels, tab switching between players, an
      opponent's revealed techs and policies visible, a hidden one not visible.
