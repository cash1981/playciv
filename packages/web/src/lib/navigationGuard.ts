export interface NavigationAttempt {
  allowed: boolean
}

/** Lets mounted views veto SPA navigation when they have unsaved work. */
export function confirmNavigation(): boolean {
  if (typeof window === 'undefined') return true
  const detail: NavigationAttempt = { allowed: true }
  window.dispatchEvent(new CustomEvent<NavigationAttempt>('civ:navigation-attempt', { detail }))
  return detail.allowed
}
