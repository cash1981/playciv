export type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'civ-theme'

export function storedTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'

  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset['theme'] = theme
  }
}

export function saveTheme(theme: Theme): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // A private browsing context may deny local storage; the in-memory choice still works.
  }
}
