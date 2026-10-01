// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { beginActivity, trackActivity, useActivity, useIsBusy } from './activity.js'

afterEach(cleanup)

describe('activity', () => {
  it('is busy from begin until the matching end, across overlapping work', () => {
    const { result } = renderHook(() => useIsBusy())
    expect(result.current).toBe(false)

    let first = (): void => {}
    let second = (): void => {}
    act(() => { first = beginActivity() })
    act(() => { second = beginActivity() })
    expect(result.current).toBe(true)

    act(() => first())
    expect(result.current).toBe(true)
    act(() => second())
    expect(result.current).toBe(false)
  })

  it('counts an end only once, so a repeated call cannot cancel other work', () => {
    const { result } = renderHook(() => useIsBusy())
    let first = (): void => {}
    let second = (): void => {}
    act(() => { first = beginActivity() })
    act(() => { second = beginActivity() })

    act(() => first())
    act(() => first())
    expect(result.current).toBe(true)
    act(() => second())
    expect(result.current).toBe(false)
  })

  it('useActivity reports while active and stops when it turns false or unmounts', () => {
    const watcher = renderHook(() => useIsBusy())
    const reporter = renderHook(({ active }) => useActivity(active), {
      initialProps: { active: false },
    })
    expect(watcher.result.current).toBe(false)

    reporter.rerender({ active: true })
    expect(watcher.result.current).toBe(true)
    reporter.rerender({ active: false })
    expect(watcher.result.current).toBe(false)

    reporter.rerender({ active: true })
    expect(watcher.result.current).toBe(true)
    reporter.unmount()
    expect(watcher.result.current).toBe(false)
  })

  it('trackActivity counts the time a promise takes, also when it fails', async () => {
    const { result } = renderHook(() => useIsBusy())
    let finish: (value: string) => void = () => {}
    let tracked: Promise<string> = Promise.resolve('')
    act(() => { tracked = trackActivity(new Promise<string>((resolve) => { finish = resolve })) })
    expect(result.current).toBe(true)
    await act(async () => { finish('done'); await tracked })
    expect(result.current).toBe(false)

    let fail: (reason: Error) => void = () => {}
    let failing: Promise<unknown> = Promise.resolve()
    act(() => {
      failing = trackActivity(new Promise<string>((_, reject) => { fail = reject })).catch(() => undefined)
    })
    expect(result.current).toBe(true)
    await act(async () => { fail(new Error('no')); await failing })
    expect(result.current).toBe(false)
  })
})
