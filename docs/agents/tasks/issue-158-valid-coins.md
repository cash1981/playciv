# Only valid coin sources in the Coins tab (issue #158)

- **Slug:** `issue-158-valid-coins`
- **Branch:** `feat/issue-158-valid-coins`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The Player status → Coins tab stops showing a counter for every player on every
one of the fifteen reference-sheet rows. A coin source is shown only where it is
currently real: a tech row only in the column of a player who has that tech
revealed, *Democracy (Govt)* only for a player whose government is Democracy,
*Panama Canal* only for a player who owns the wonder in the Wonders area, and
*Organized Religion* only for a player whose revealed social policy is Organized
Religion. *Bank (Building)*, *Great People*, *Terrain* and *Sheet* stay
available to everyone. A player cell without the source is empty, and a source
row whose cells are all empty is not rendered at all. The Great People helper
text "50% chance of providing 1 coin" is removed. When a source becomes invalid
the engine resets its counter to 0 — a government change away from Democracy, a
removed tech, a removed social policy — and a counter that still holds coins for
any other reason stays visible until it is counted down, so a coin can never
become invisible.

## Why

The human asked in issue #158:

> Look at what a player has researched, and then only when something is teched
> and revealed, you can show it in the coins and only allow for that player to
> choose it. The same goes for wonders and organized religion
>
> Also no need to have the text "50% chance of providing 1 coin"
>
> Democracy government can also only be displayed if someone actually has
> picked it.
>
> This way makes the page much more readable and less og mer oversiktlig

In the follow-up conversation (2026-09-23) the human settled:

- Anyone may still edit any counter — the coin counters stay shared
  bookkeeping. The restriction is display only: "Det jeg mente er at UI
  visningen kun vises for den som eier det. Ikke vits at en spiller kan justere
  coins i code of law, hvis dem ikke har den techen."
- The matrix stays; a cell without the source is empty.
- Bank, Great People, Terrain and Sheet always show (Bank is not conditional).
- A government change away from Democracy removes the *Democracy (Govt)* coin
  and hides it: "Hvis government byttes så skal den coinen fjernes, med mindre
  settes til 0 og heller ikke ha det synlig."
- Social policies are like government — they can be swapped or removed, and the
  coin goes with them. Tech removal is a correction path (the rules do not let a
  tech disappear), and its coin goes too: "da tenker jeg det er greit at du også
  fjerner den dersom techen ikke er der. Men det er edge case."
- A counter with coins on it is never hidden: "Jeg ønsker den vekk fra visning
  dersom man ikke lengre har noe der." Coins on it are "something there".

## Scope

**In:**

- Engine: a tech-name → coin-source mapping and a policy-name → coin-source
  mapping in `coins.ts`; `removeTech`, `removeSocialPolicy` and
  `setPlayerGovernment` reset the affected counter to 0; tests for the mapping
  and the three resets.
- Web: the `StatusPanel` Coins section computes which sources each player
  currently has and renders rows and cells accordingly; a value > 0 keeps a cell
  visible; the Great People help text is emptied; tests.
- Docs: this brief, the task board, `state.md`, `decisions.md`, and the
  coin-source paragraph in `README.md` if it promises all fifteen rows.

**Out:**

- **Permission changes.** `setCoinSource` and its route keep accepting any
  current player editing any counter; only the UI hides invalid cells. The
  human kept the shared-bookkeeping model.
- **Automatic coin awards.** Democracy's printed "+1 coin" and every other card
  effect stay manual bookkeeping, as `coin-tab.md` already states.
- **The Internet's +2 cap.** Unchanged (issue #145).
- **Removing a wonder from the board, or clearing its owner, does not reset
  *Panama Canal*.** The human states the wonder cannot be killed, and board
  history replay must not gain a coin side effect. The value > 0 rule keeps any
  such counter visible and editable until it is counted down; see
  `decisions.md`.
- **No engine gate on availability.** A stale client can still set an invalid
  source through the API; the row then shows again because its value is > 0.
  This is deliberate, per the first point.

## Reference

There is no old-system counterpart: coin sources are new in this port (see
`docs/agents/tasks/coin-tab.md`). Neither `old-civ-rest` nor `old-civ-web`
modelled them, so the specification is the human's reference sheet and the
answers above.

## Approach

**Engine (`packages/engine`)**

- `coins.ts`:
  - `techCoinSource(techName: string): CoinSourceKey | undefined` maps the
    eight printed tech names — `Code of Laws`, `Pottery`, `Civil Service`,
    `Democracy`, `Printing Press`, `Bureaucracy`, `Railroad`, `Computers` — to
    `codeOfLaws`, `pottery`, `civilService`, `democracy`, `printingPress`,
    `bureaucracy`, `railroad`, `computers`.
  - `socialPolicyCoinSource(policyName: string): CoinSourceKey | undefined`
    maps `Organized Religion` to `organizedReligion` (the policy's flipside,
    Natural Religion, is not the coin card).
  - `ALWAYS_AVAILABLE_COIN_SOURCES` is the list the Coins table always shows:
    `bank`, `greatPeople`, `terrain`, `sheet`.
  - The Great People entry's `help` becomes `''`.
- `actions/player.ts`:
  - `removeTech` resets the mapped source on the same player.
  - `removeSocialPolicy` resets the mapped source on the same player.
  - `setPlayerGovernment` resets `democracyGovernment` when the new government
    is not `Democracy`.
  - Each reducer keeps its one existing public log line; the reset adds no
    second line (see `decisions.md`).
- `test/coin-sources.test.ts`: mapping tests, the three resets, that unrelated
  counters and other players are untouched, and a table test asserting every
  `COIN_SOURCES` key is either mapped or in `ALWAYS_AVAILABLE_COIN_SOURCES`, so
  a future source cannot be silently omitted from the table.

**Web (`packages/web`)**

- `views/StatusPanel.tsx`:
  - `Row` gains `revealedTechNames` and `revealedPolicyNames`, built from
    `view.you.techsChosen` / `view.you.socialPolicies` filtered on `!hidden`
    and from the opponents' `revealedTechs` / `revealedSocialPolicies` — the
    same filter for everyone, so the viewer's own hidden tech cannot leak
    through the shared table.
  - The Panama Canal owner set is built from board pieces with
    `assetId === 'wonders/panamacanal'` and `isInWondersArea`, like the
    existing `internetOwners` set.
  - A helper computes each player's available sources: the always-available
    four, the mapped tech sources, the mapped policy source,
    `democracyGovernment` when the government is `Democracy`, and
    `panamaCanal` when the owner set contains the player.
  - A source row renders when at least one player is available **or** holds a
    value > 0 on it; a player cell renders the `CoinCounter` only then and
    otherwise an empty `<td />`.
  - The muted help span renders only when `source.help` is non-empty.
- `views/StatusPanel.test.tsx`: the shared fixture gains revealed techs, a
  revealed policy and a Panama Canal piece where the existing assertions need
  them, plus new tests for each rule above, the hidden-tech non-leak, the
  removed help text and the value > 0 fallback.

## Claimed paths

- `packages/engine/src/coins.ts`
- `packages/engine/src/actions/player.ts` (the three reducers and the mapping
  imports only)
- `packages/engine/test/coin-sources.test.ts`
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/StatusPanel.test.tsx`
- `docs/agents/tasks/issue-158-valid-coins.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`
- `README.md` (the coin paragraph only)

## Acceptance criteria

- [ ] A tech row renders only for a player whose matching tech is revealed; a
      hidden tech renders nothing, and no other player's column gains a counter
      for it.
- [ ] `Democracy (Govt)` renders only for a player whose government is
      Democracy; changing the government away resets the counter to 0 in the
      engine.
- [ ] `Panama Canal` renders only for the owner of the Panama Canal piece in
      the Wonders area.
- [ ] `Organized Religion` renders only for a player with that revealed social
      policy; removing the policy resets the counter.
- [ ] `Bank (Building)`, `Great People`, `Terrain` and `Sheet` render for every
      player.
- [ ] The Great People helper text "50% chance of providing 1 coin" no longer
      renders.
- [ ] A counter with value > 0 is never hidden, even when its source is
      currently invalid.
- [ ] A row whose cells are all empty is not rendered; the Total row still
      equals each player's summed counters and the Status table's Coins cell.
- [ ] Spectator/replay and `busy` behaviour are unchanged, and any member may
      still edit any player's counters.
- [ ] Hidden information: only `revealedTechs` / `revealedSocialPolicies`
      (public data) decide visibility, for the viewer's own column too; a
      hidden tech in `view.you` adds no row for anyone, and the test fails if
      the `!hidden` filter is removed.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: the Coins tab with and without a revealed tech,
      a Democracy government, a Panama Canal owner and an Organized Religion
      policy; the help text is gone and the totals match the Status table.

## Open questions

None. The four that mattered were answered by the human before the work
started: display-only restriction, the matrix with empty cells, the
source → state mapping with Bank always visible, and reset-on-invalid with a
counter never hidden.
