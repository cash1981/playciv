// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_TOASTS, TOAST_MS, clearToasts, showToast } from '../lib/toasts.js'
import { ToastRegion } from './ToastRegion.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => clearToasts())
  cleanup()
  vi.useRealTimers()
})

describe('ToastRegion', () => {
  it('shows a success as a status and closes it by itself', () => {
    render(<ToastRegion />)
    act(() => void showToast('ok', 'You drew Pottery'))
    expect(screen.getByRole('status').textContent).toContain('You drew Pottery')
    act(() => vi.advanceTimersByTime(TOAST_MS.ok - 1))
    expect(screen.queryByText('You drew Pottery')).not.toBeNull()
    act(() => vi.advanceTimersByTime(2))
    expect(screen.queryByText('You drew Pottery')).toBeNull()
  })

  it('keeps a success for seven seconds', () => {
    render(<ToastRegion />)
    act(() => void showToast('ok', 'You drew Pottery'))
    act(() => vi.advanceTimersByTime(6_999))
    expect(screen.queryByText('You drew Pottery')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText('You drew Pottery')).toBeNull()
  })

  it('shows a failure as an alert that stays longer, and can be closed', () => {
    render(<ToastRegion />)
    act(() => void showToast('error', 'Failed to fetch'))
    expect(screen.getByRole('alert').querySelector('.toast')?.className).toContain('toast-error')
    act(() => vi.advanceTimersByTime(TOAST_MS.ok + 1))
    expect(screen.queryByText('Failed to fetch')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Failed to fetch')).toBeNull()
  })

  it('keeps a toast while the pointer is over it', () => {
    render(<ToastRegion />)
    act(() => void showToast('ok', 'Held'))
    const toast = screen.getByRole('status').querySelector('.toast') as HTMLElement
    fireEvent.pointerEnter(toast)
    act(() => vi.advanceTimersByTime(TOAST_MS.ok * 3))
    expect(screen.queryByText('Held')).not.toBeNull()
    fireEvent.pointerLeave(toast)
    act(() => vi.advanceTimersByTime(TOAST_MS.ok + 1))
    expect(screen.queryByText('Held')).toBeNull()
  })

  it('does not stack the same message twice and caps the pile', () => {
    render(<ToastRegion />)
    act(() => {
      showToast('ok', 'Same')
      showToast('ok', 'Same')
    })
    expect(screen.getAllByText('Same')).toHaveLength(1)
    act(() => {
      for (let i = 0; i < MAX_TOASTS + 2; i++) showToast('ok', `Message ${i}`)
    })
    expect(document.querySelectorAll('.toast')).toHaveLength(MAX_TOASTS)
    expect(screen.queryByText('Message 0')).toBeNull()
  })

  it('ignores an empty message', () => {
    render(<ToastRegion />)
    act(() => void showToast('ok', '   '))
    expect(document.querySelectorAll('.toast')).toHaveLength(0)
  })

  it('keeps a toast while focus is inside it', () => {
    render(<ToastRegion />)
    act(() => void showToast('error', 'Look at me'))
    const close = screen.getByRole('button', { name: 'Dismiss' })
    fireEvent.focus(close)
    act(() => vi.advanceTimersByTime(TOAST_MS.error * 3))
    expect(screen.queryByText('Look at me')).not.toBeNull()
    fireEvent.blur(close)
    act(() => vi.advanceTimersByTime(TOAST_MS.error + 1))
    expect(screen.queryByText('Look at me')).toBeNull()
  })

  it('restarts the clock when the same message comes again', () => {
    render(<ToastRegion />)
    act(() => void showToast('ok', 'Again'))
    act(() => vi.advanceTimersByTime(TOAST_MS.ok - 500))
    act(() => void showToast('ok', 'Again'))
    act(() => vi.advanceTimersByTime(TOAST_MS.ok - 500))
    expect(screen.queryByText('Again')).not.toBeNull()
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByText('Again')).toBeNull()
  })

  it('keeps both live regions mounted while there is nothing to say', () => {
    render(<ToastRegion />)
    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.getByRole('alert').textContent).toBe('')
  })
})
