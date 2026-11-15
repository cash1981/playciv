/**
 * Scrolls to a collapsible panel, opening it first if it is collapsed: hidden
 * content is not on the page, so the panel's toggle is clicked and the scroll
 * waits for React to show the content. Smooth unless the player asks for reduced
 * motion. `targetId` names an element inside the panel to scroll to instead.
 */
export function revealPanel(panelId: string, targetId?: string): void {
  const toggle = document.querySelector<HTMLElement>(`[aria-controls="${panelId}-content"]`)
  const collapsed = toggle?.getAttribute('aria-expanded') === 'false'
  if (collapsed) toggle?.click()
  const show = (): void => {
    const target =
      (targetId === undefined ? null : document.getElementById(targetId)) ?? toggle?.closest('section') ?? null
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }
  if (collapsed) queueMicrotask(show)
  else show()
}
