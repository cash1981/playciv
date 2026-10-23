/**
 * The "Your actions" panel with City Management open, for the tests written when the panel
 * had no tabs: its cities, Build and the culture advance are all in that tab.
 */

import type { ComponentProps } from 'react'

import { PhaseActionsPanel } from './PhaseTabs.js'

export function AssistedActionsPanel(props: ComponentProps<typeof PhaseActionsPanel>): React.JSX.Element | null {
  return <PhaseActionsPanel initialPhase="CM" {...props} />
}
