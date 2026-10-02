# Coin defaults and Anarchy

- **Slug:** `coin-defaults`
- **Branch:** `feat/coin-defaults`
- **Owner:** Claude (orchestrator; coder role)
- **Status:** done

## Goal

A flat "1 coin" source starts at 1 in the Coins tab as soon as the card that
holds it is revealed, instead of at 0 for the player to raise by hand. The
player can still lower it to 0. Under the Anarchy government the Organized
Religion coin is 0, because social policies have no effect there.

## Why

The human, 2026-10-02: "Hvis Anarchy ikke kan bli valgt som goverment må denne
legges til. Deretter kan du implementere denne regelen med å automatisk sette
coins til 0. Ingen social policies er i effekt dersom man er i anarchy." And on
the other sources: "du finner andre eksempler også ... hvis man har en tech som
gir coin. F.eks Bureaucracy o.l". Also: "dersom noen fjerner Org. Rel så fjern
den helt", and "Kun nye" (existing games are not migrated).

The human also reported that a revealed Organized Religion did not show in the
Coins tab of a live game. It could not be reproduced from the code (the row
renders for a revealed policy, and the web tests cover it); the live game was
not reachable from the session. See Open questions.

## Scope

**In:**

- `revealSocialPolicy`: set `organizedReligion` to 1 (0 under Anarchy).
- `revealTech`: set the flat 1-coin tech sources (Civil Service, Bureaucracy,
  Railroad, Computers) to 1.
- `setPlayerGovernment`: Democracy sets `democracyGovernment` to 1 (already
  cleared when leaving Democracy). Anarchy sets `organizedReligion` to 0;
  leaving Anarchy sets it to 1 again if Organized Religion is revealed.
- Removing the card, including undoing the tech choice, clears its counter.
- Tests, `decisions.md`, `state.md`, README line.

**Out:**

- Existing games are not migrated (the human said "kun nye").
- Hidden cards never set a counter: `coinSources` is public, so a counter set
  at choose time would leak a hidden tech or policy (rule 4).
- Techs with a 4 coin limit (Code of Laws, Pottery, Democracy, Printing Press):
  their coins are earned by playing, not given up front.
- Bank, Great People, Terrain, Panama Canal, Sheet: not tied to a card.
- Other policies under Anarchy: no other policy holds a coin source.

## Reference

No old-system equivalent: the old application had no coin sources. This is a
human-requested behaviour; see `decisions.md`. The Anarchy card text is already
in `government.ts`: "Your social policies have no effect."

## Approach

Engine only. A helper in `coins.ts` names the revealed starting value of a
source. `revealTech`, `revealSocialPolicy` and `setPlayerGovernment` in
`actions/player.ts` use it. No state shape change.

## Claimed paths

- `packages/engine/src/coins.ts`
- `packages/engine/src/actions/player.ts`, `packages/engine/src/actions/undo.ts`
- `packages/engine/test/coin-sources.test.ts`
- `docs/agents/decisions.md`, `docs/agents/state.md`, `README.md`

## Acceptance criteria

- [ ] Revealing Organized Religion sets its counter to 1; under Anarchy, 0.
- [ ] Revealing Civil Service, Bureaucracy, Railroad or Computers sets 1.
- [ ] Setting Democracy sets Democracy (Govt) to 1.
- [ ] Setting Anarchy zeroes Organized Religion; leaving it restores 1 when the
      policy is revealed, and leaves it at 0 when the policy is not revealed.
- [ ] Revealing or choosing a card never changes another player's counters.
- [ ] A hidden policy or tech has counter 0 in every projection.
- [ ] The counter can still be lowered to 0 and raised to 1 by hand.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass

## Open questions

- Live game `bcd21671a7fde335`: Organized Religion did not appear in Coins
  after being "activated". Most likely the policy was chosen but not revealed;
  the row follows the revealed policy by design. Asked the human to confirm.
