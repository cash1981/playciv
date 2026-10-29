/**
 * Which build the page is running, and whether a newer one has been deployed.
 *
 * `vite build` writes the same id into the bundle (`__BUILD_ID__`) and into
 * `/version.json`, which the host serves without caching. A tab that was open
 * during a deploy keeps the old JavaScript until it reloads, so the app asks for
 * `version.json` now and then and offers a reload when the ids differ. The
 * hashed files under `/assets/` can be cached for good, as a new build has new names.
 */

declare const __BUILD_ID__: string | undefined

/** The id of the running bundle; `dev` under `vite dev` and in tests. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

/**
 * The id of the deployed build, or `null` when it cannot be read: offline, no
 * `version.json` (the host answers a missing file with the page itself), or a
 * body that is not what the build writes.
 */
export async function fetchDeployedBuildId(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher('/version.json', { cache: 'no-store' })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return null
    const id = (body as { id?: unknown }).id
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}

/** Whether the deployed build is a different one than the page runs. Never in dev, where there is no build. */
export const isNewerBuild = (running: string, deployed: string | null): boolean =>
  running !== 'dev' && deployed !== null && deployed !== running
