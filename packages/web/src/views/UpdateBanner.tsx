/**
 * Offers a reload when a newer build has been deployed since this tab loaded
 * (see `lib/buildVersion.ts`). It checks when the tab becomes visible again and
 * every few minutes, never reloads by itself, and stays out of the way until then.
 */

import { useEffect, useState } from 'react'

import { BUILD_ID, fetchDeployedBuildId, isNewerBuild } from '../lib/buildVersion.js'
import './UpdateBanner.css'

const CHECK_EVERY_MS = 5 * 60 * 1000

export function UpdateBanner({ running = BUILD_ID }: { readonly running?: string }): React.JSX.Element | null {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (running === 'dev') return undefined
    let live = true
    const check = (): void => {
      void fetchDeployedBuildId().then((deployed) => {
        if (live && isNewerBuild(running, deployed)) setStale(true)
      })
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check()
    }
    const timer = setInterval(check, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    check()
    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running])

  if (!stale) return null
  return (
    <div className="update-banner" role="status">
      <span>A new version of Playciv is available.</span>
      <button type="button" className="small" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}
