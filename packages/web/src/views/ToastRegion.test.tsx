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

  it('shows a failure as an alert that stays longer, and can be closed', () => {
    render(<ToastRegion />)
    act(() => void showToast('error', 'Failed to fetch'))
    expect(screen.getByRole('alert').className).toContain('toast-error')
    act(() => vi.advanceTimersByTime(TOAST_MS.ok + 1))
    expect(screen.queryByText('Failed to fetch')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Failed to fetch')).toBeNull()
  })

  it('keeps a toast while the pointer is over it', () => {
    render(<ToastRegion />)
    act(() => void showToast('ok', 'Held'))
    const toast = screen.getByRole('status')
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
    expect(screen.getAllByRole('status')).toHaveLength(MAX_TOASTS)
    expect(screen.queryByText('Message 0')).toBeNull()
  })

  it('ignores an empty message', () => {
    render(<ToastRegion />)
    act(() => void showToast('ok', '   '))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
