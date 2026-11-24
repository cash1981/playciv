# Social policy slots and cap (#378)

- **Slug:** `social-policy-slots-378` · **Branch:** `feat/civ-abilities-romans-chinese-spain` · **Owner:** orchestrator + coder · **Status:** claimed

## Goal

The game knows how many social policies a player may hold and enforces it. Human (2026-11-24): keep today's flow where the
player is scrolled to the Social policy panel and chooses there; add the French extra policy, the pick after a new city, and
a limit on the number of policies.

## Reference

Wisdom and Warfare rulebook p. 10 (`packages/web/public/help/CI03_WW_Rulebook.pdf`), "Social Policies":

- The social policy maximum equals the number of the civilization's **built cities**. Each time it increases the player must
  immediately adopt a new policy (a card they do not hold, flipped to the chosen side; the flipside of a held card is refused).
- Everyone starts with maximum 1 and adopts a policy in step 1 of Player Setup. **French:** start with maximum 2 (one
  additional policy) and the maximum is increased by one: French maximum = cities + 1, with 2 policies at the start.
- When the maximum decreases (a city lost) the player returns a held policy of their choice.
- Switching (Bureaucracy, culture cards) is remove then choose: the count is unchanged.
- Rulings 389-390: Anarchy keeps the policies held; no effect, but they still count.

Current code: `chooseSocialPolicy` / `removeSocialPolicy` in `engine/src/actions/player.ts`; setup step `policy` in
`engine/src/setup.ts` (done at one policy, `stepDone` and `setupViewOf`); `ownCityPieces` (`city-founding.ts`) and `cityCountOf`
(`state.ts`) count city pieces on the map; the found-city log note in `assisted-city.ts` ("may now adopt another social
policy") compares policies with cities; web `SocialPolicyPanel.tsx`; panel scrolling `goToPanel('social-policy', true)` in
`SetupPanel.tsx` / `PhaseTabs.tsx` (the `seenGrants` pattern scrolls to techs when a grant appears).

## Approach

Slots are derived, nothing new is stored: they follow the board, so a manual city, a conquest, a nuke or an undo of the city
all move the cap without extra bookkeeping.

1. Engine, new `social-policy-slots.ts` (exported from `index.ts`): `socialPolicySlots(state, player)` returns
   `{ maximum, held, free }`: `maximum = max(1, own city pieces) + (French ? 1 : 0)` (the `max(1, ...)` lets the starting
   policy be chosen before the capital is placed), `held = player.socialPolicies.length`, `free = max(0, maximum - held)`.
   `held > maximum` is an over-the-cap state (see 3), not an error.
2. `chooseSocialPolicy` refuses when `free === 0` with a new error kind (add to `errors.ts`, the server's error mapping and any
   exhaustive switch), message names the maximum and the held count ("one per built city, one more for the French").
3. Own view `you.socialPolicySlots: { maximum, held, free }` (null in replays like the other own-only fields, `routes/games.ts`);
   the public view is unchanged (`numberOfSocialPolicies` stays). Over the cap is shown, not enforced: the web tells the player
   to remove one; `removeSocialPolicy` is unchanged.
4. Setup: the `policy` step needs the starting policies: 1, 2 for the French (`stepDone`, `setupViewOf`, reason texts). An
   older game with the French on one policy is simply not done yet; check `setupStillOpen` / `finishSetup` for a player who
   already finished setup with one policy: they must not be reopened (setup done stays done).
5. `assisted-city.ts`: the found-city note says "may now adopt another social policy" from `free > 0`, not by comparing counts.
6. Web `SocialPolicyPanel.tsx`: a status line (role="status") above the picker: "You may adopt N more social policy" /
   "You hold the most social policies you may (N): one per built city" (French: one more) / over the cap: "You hold N, more than
   the M you may: remove one". Choose is disabled with that reason when `free === 0`. Scroll to the panel
   (`goToPanel('social-policy', true)`) when `free` rises above the value last seen in this session (not on first render,
   not on a replay), the way `PhaseTabs` does for tech grants. Setup's own scrolling stays.
7. Tests: engine (slots for 0/1/many cities, French, refusal, remove then choose, undo of a city leaves free at 0 and held >
   maximum without a throw, Anarchy keeps the count, setup step for French and the not-reopened case), server (error code,
   view field, replay blanking), web (panel text and disabled Choose, scroll once on a rise). Hidden information: the view
   field holds counts only, no policy names; a test that an opponent's view has no `socialPolicySlots` and that
   `numberOfSocialPolicies` is unchanged.
8. Docs: `decisions.md` ("Setup phase": the French line, the new "Social policy slots" topic with the rule source),
   `limitations.md` (remove "the French extra policy and policy cap (#378)" from the not-automated list; add: a lost city does
   not force a return, only shows a prompt).

## Claimed paths

- `packages/engine/src/` (social-policy-slots.ts, index.ts, actions/player.ts, setup.ts, assisted-city.ts, errors.ts, state.ts),
  `packages/engine/test/`, `packages/server/src/` (errors.ts, routes/games.ts), `packages/server/test/`,
  `packages/web/src/views/` (SocialPolicyPanel.tsx, SetupPanel.tsx) and their tests, `packages/web/src/lib/api.ts`,
  `docs/agents/decisions.md`, `docs/agents/limitations.md`

## Acceptance criteria

- [ ] Choosing a policy beyond the cap is refused by the engine; remove-then-choose works
- [ ] French: 2 policies in setup and cities + 1 after
- [ ] The panel says how many may be adopted and scrolls into view when a slot is gained
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: counts only, in the own view
- [ ] Browser check: build a city, the panel opens with the message; choose; Choose is disabled afterwards

## Open questions

None blocking. Whether a conquered city counts follows `ownCityPieces` (city pieces of the player's colour on the map).
