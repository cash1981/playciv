import { useEffect, useState } from 'react'

/**
 * The open state of a collapsible panel, remembered across a page reload in
 * `localStorage` under `civ.panel.<id>` (issue #71). `defaultOpen` is only the
 * fallback for the first time an `id` is seen on this browser, or when storage
 * cannot be read; every storage failure is swallowed.
 */
export function usePanelOpen(id: string, defaultOpen: boolean): readonly [boolean, (open: boolean) => void] {
  const storageKey = `civ.panel.${id}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored === null ? defaultOpen : stored === 'true'
    } catch {
      return defaultOpen
    }
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(open)) } catch {}
  }, [storageKey, open])

  return [open, setOpen]
}
