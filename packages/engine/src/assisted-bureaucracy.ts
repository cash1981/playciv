/**
 * Bureaucracy (issue #327, slice 2): "Once per turn, you may switch one of your social policies during research. Unlocks:
 * 1 coin." The engine never limits when or how often a social policy is chosen or removed (`actions/player.ts`), so there
 * is nothing to permit: the action is a once-per-turn logged note in the open Research phase, and the switch itself stays
 * the player's, made by hand in the social policy panel. Costs nothing. The 1 coin comes from the flat-coin handling of
 * `coins.ts` when the tech is revealed.
 */

import { ok } from './result.js'
import { techAbility } from './assisted-tech-abilities.js'

export const bureaucracy = techAbility<'bureaucracy', null>({
  kind: 'bureaucracy',
  techName: 'Bureaucracy',
  effectKind: 'bureaucracy',
  phase: 'RESEARCH',
  buttonText: 'Use Bureaucracy (switch one social policy)',
  payment: { kind: 'none' },

  plan: () => ok(null),

  act: (state, _player, _plan, spent) =>
    ok({
      state,
      said: 'may switch one of their social policies during research (the switch is made by hand in the social policy panel)',
      effect: { kind: 'bureaucracy', spent },
    }),

  undo: (state) => ok({ state, said: ': the policy switch is no longer logged (the policies are not changed by the game)' }),
})
