// @vitest-environment jsdom

import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownEditor } from './MarkdownEditor.js'
import type { MarkdownEditorHandle } from './MarkdownEditor.js'

interface MockCrepeBuilderRecord {
  created: boolean
  destroyed: boolean
  markdown: string
}

const milkdownLifecycle = vi.hoisted(() => ({
  create: (): Promise<void> => Promise.resolve(),
  getMarkdownCalls: 0,
  instances: [] as MockCrepeBuilderRecord[],
}))

vi.mock('@milkdown/crepe/builder', () => ({
  CrepeBuilder: class MockCrepeBuilder implements MockCrepeBuilderRecord {
    created = false
    destroyed = false
    markdown: string
    readonly editor = {
      action: (command: { readonly markdown?: string }): void => {
        if (command.markdown !== undefined) this.markdown = command.markdown
      },
    }

    constructor(options: { readonly defaultValue: string }) {
      this.markdown = options.defaultValue
      milkdownLifecycle.instances.push(this)
    }

    addFeature(): this {
      return this
    }

    setReadonly(): this {
      return this
    }

    on(register: (listener: { markdownUpdated: (callback: () => void) => void }) => void): void {
      register({ markdownUpdated: () => undefined })
    }

    async create(): Promise<void> {
      await milkdownLifecycle.create()
      this.created = true
    }

    getMarkdown(): string {
      milkdownLifecycle.getMarkdownCalls += 1
      if (!this.created) throw new Error('getMarkdown called before create completed')
      return this.markdown
    }

    destroy(): Promise<void> {
      this.destroyed = true
      return Promise.resolve()
    }
  },
}))

vi.mock('@milkdown/crepe/feature/link-tooltip', () => ({ linkTooltip: {} }))
vi.mock('@milkdown/crepe/feature/list-item', () => ({ listItem: {} }))
vi.mock('@milkdown/crepe/feature/placeholder', () => ({ placeholder: {} }))
vi.mock('@milkdown/crepe/feature/toolbar', () => ({ toolbar: {} }))
vi.mock('@milkdown/crepe/feature/top-bar', () => ({ topBar: {} }))
vi.mock('@milkdown/kit/utils', () => ({
  replaceAll: (markdown: string): { readonly markdown: string } => ({ markdown }),
}))

const noop = (): void => undefined

/**
 * Flushes the mocked api promises and the React updates they trigger.
 *
 * `findBy*`/`waitFor` poll against a one-second wall-clock deadline, and the
 * full suite's parallel workers can starve those polls long enough to miss it
 * (issue #146). The conditions this file waits for are promise-driven, so an
 * `act` flush is enough and no deadline takes part.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  milkdownLifecycle.create = () => Promise.resolve()
  milkdownLifecycle.getMarkdownCalls = 0
  milkdownLifecycle.instances.length = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MarkdownEditor lifecycle', () => {
  it('saves from the fallback and unmounts safely while Crepe is still loading', async () => {
    let resolveCreate: (() => void) | undefined
    milkdownLifecycle.create = () =>
      new Promise<void>((resolve) => {
        resolveCreate = resolve
      })
    const editorRef = createRef<MarkdownEditorHandle>()
    const saved: string[] = []
    const { unmount } = render(
      <>
        <MarkdownEditor
          ref={editorRef}
          value="Initial"
          onChange={noop}
          readOnly={false}
          ariaLabel="Lifecycle editor"
        />
        <button type="button" onClick={() => saved.push(editorRef.current?.getMarkdown() ?? '')}>
          Save lifecycle editor
        </button>
      </>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Lifecycle editor' }), {
      target: { value: 'Written while loading' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save lifecycle editor' }))

    expect(saved).toEqual(['Written while loading'])
    expect(milkdownLifecycle.getMarkdownCalls).toBe(0)
    // The editor's dynamic imports are served by Vite's transform pipeline, so
    // wait on the module runner's own bookkeeping instead of a wall-clock
    // deadline (issue #146).
    await vi.dynamicImportSettled()
    expect(milkdownLifecycle.instances).toHaveLength(1)
    unmount()
    expect(milkdownLifecycle.getMarkdownCalls).toBe(0)

    await act(async () => {
      resolveCreate?.()
      await Promise.resolve()
    })
    expect(milkdownLifecycle.instances[0]?.destroyed).toBe(true)
    expect(milkdownLifecycle.getMarkdownCalls).toBe(0)
  })

  it('keeps fallback saving available after Crepe initialization rejects', async () => {
    milkdownLifecycle.create = () => Promise.reject(new Error('create failed'))
    const editorRef = createRef<MarkdownEditorHandle>()
    const saved: string[] = []
    render(
      <>
        <MarkdownEditor
          ref={editorRef}
          value="Initial"
          onChange={noop}
          readOnly={false}
          ariaLabel="Rejected editor"
        />
        <button type="button" onClick={() => saved.push(editorRef.current?.getMarkdown() ?? '')}>
          Save rejected editor
        </button>
      </>,
    )

    await vi.dynamicImportSettled()
    await settle()
    expect(screen.getByText('Rich editing is unavailable; plain Markdown is active.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Rejected editor' }), {
      target: { value: 'Fallback Markdown' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save rejected editor' }))

    expect(saved).toEqual(['Fallback Markdown'])
    expect(milkdownLifecycle.getMarkdownCalls).toBe(0)
  })
})
