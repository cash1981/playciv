import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ForwardRefExoticComponent, RefAttributes } from 'react'

import type { CrepeBuilder } from '@milkdown/crepe/builder'

import './MarkdownEditor.css'

export interface MarkdownEditorHandle {
  /** Returns the editor document immediately, without waiting for markdownUpdated. */
  readonly getMarkdown: () => string
}

export interface MarkdownEditorProps {
  readonly value: string
  readonly onChange: (markdown: string) => void
  readonly onDirty?: (() => void) | undefined
  readonly readOnly: boolean
  readonly ariaLabel: string
  readonly placeholder?: string
  /**
   * `simple` trims Crepe's formatting bar to a text style (Normal or Heading),
   * bold and italic, each with a name for screen readers and a tooltip. The
   * default keeps the full bar, which the private log uses.
   */
  readonly toolbar?: 'full' | 'simple'
}

export type MarkdownEditorComponent = ForwardRefExoticComponent<
  MarkdownEditorProps & RefAttributes<MarkdownEditorHandle>
>

/** A controlled Crepe editor whose value is stored as Markdown. */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      onChange,
      onDirty,
      readOnly,
      ariaLabel,
      placeholder = 'Write in Markdown …',
      toolbar: toolbarKind = 'full',
    },
    ref,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<CrepeBuilder | null>(null)
    const onChangeRef = useRef(onChange)
    const onDirtyRef = useRef(onDirty)
    const readOnlyRef = useRef(readOnly)
    const latestMarkdownRef = useRef(value)
    const lastEmittedRef = useRef(value)
    const previousValueRef = useRef(value)
    // What this editor has reported since its value last matched the document.
    // Milkdown reports 200 ms after a keystroke, so a value that comes back from
    // the parent can be older than the document: the player typed on while it
    // was rendered. Writing that value into the editor undoes the typing and
    // drops the cursor, so a value in this set is an echo and is left alone.
    const echoesRef = useRef(new Set<string>())
    const [ready, setReady] = useState(false)
    const [editorError, setEditorError] = useState(false)

    onChangeRef.current = onChange
    onDirtyRef.current = onDirty
    readOnlyRef.current = readOnly
    if (previousValueRef.current !== value) {
      previousValueRef.current = value
      if (!echoesRef.current.has(value)) {
        latestMarkdownRef.current = value
        lastEmittedRef.current = value
      }
    }

    const readMarkdown = (): string => editorRef.current?.getMarkdown() ?? latestMarkdownRef.current

    const emitMarkdown = (markdown: string): void => {
      latestMarkdownRef.current = markdown
      if (markdown === lastEmittedRef.current) return
      lastEmittedRef.current = markdown
      // Only the rich editor reports late. The fallback textarea reports as it is
      // typed, so nothing it says can be stale, and the effect that empties this
      // set does not run until the rich editor is ready.
      if (editorRef.current !== null) {
        const echoes = echoesRef.current
        echoes.add(markdown)
        // A player cannot out-type the render by many reports, so the newest few are enough
        if (echoes.size > 20) {
          for (const oldest of echoes) {
            echoes.delete(oldest)
            break
          }
        }
      }
      onChangeRef.current(markdown)
    }

    useImperativeHandle(ref, () => ({ getMarkdown: readMarkdown }))

    // Crepe's bar buttons are bare icons. Give each a name for screen readers and
    // a tooltip, and keep the pressed state in step as the bar redraws.
    useEffect(() => {
      const root = rootRef.current
      if (root === null || toolbarKind !== 'simple') return
      const names: Readonly<Record<string, string>> = { bold: 'Bold', italic: 'Italic' }
      const label = (): void => {
        const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.milkdown-top-bar .top-bar-item'))
        const keys = ['bold', 'italic']
        items.forEach((button, index) => {
          const name = names[keys[index] ?? ''] ?? 'Format'
          button.title = name
          button.setAttribute('aria-label', name)
          button.setAttribute('aria-pressed', String(button.classList.contains('active')))
        })
        const style = root.querySelector<HTMLButtonElement>('.milkdown-top-bar .top-bar-heading-button')
        if (style !== null) {
          style.title = 'Text style: Normal or Heading'
          style.setAttribute('aria-label', 'Text style')
          style.setAttribute('aria-haspopup', 'listbox')
        }
        root.querySelectorAll<HTMLButtonElement>('.milkdown-top-bar .top-bar-heading-option').forEach((option) => {
          option.title = `Make this ${option.textContent?.toLowerCase() ?? 'text'}`
        })
      }
      label()
      const observer = new MutationObserver(label)
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
      return () => observer.disconnect()
    }, [toolbarKind])

    useEffect(() => {
      const root = rootRef.current
      if (root === null) return

      let mounted = true

      void Promise.all([
        import('@milkdown/crepe/builder'),
        import('@milkdown/crepe/feature/link-tooltip'),
        import('@milkdown/crepe/feature/list-item'),
        import('@milkdown/crepe/feature/placeholder'),
        import('@milkdown/crepe/feature/toolbar'),
        import('@milkdown/crepe/feature/top-bar'),
        import('@milkdown/kit/utils'),
        import('@milkdown/crepe/theme/common/link-tooltip.css'),
        import('@milkdown/crepe/theme/common/list-item.css'),
        import('@milkdown/crepe/theme/common/placeholder.css'),
        import('@milkdown/crepe/theme/common/prosemirror.css'),
        import('@milkdown/crepe/theme/common/reset.css'),
        import('@milkdown/crepe/theme/common/toolbar.css'),
        import('@milkdown/crepe/theme/common/top-bar.css'),
        import('@milkdown/crepe/theme/frame.css'),
      ]).then(
        ([
          { CrepeBuilder },
          { linkTooltip },
          { listItem },
          { placeholder: placeholderFeature },
          { toolbar },
          { topBar },
          { replaceAll },
        ]) => {
          if (!mounted) return undefined
          const nextEditor = new CrepeBuilder({
            root,
            defaultValue: latestMarkdownRef.current,
          })
            .addFeature(listItem)
            .addFeature(linkTooltip)
            .addFeature(toolbar)
            .addFeature(
              topBar,
              toolbarKind === 'simple'
                ? {
                    headingOptions: [
                      { label: 'Normal', level: null },
                      { label: 'Heading', level: 3 },
                    ],
                    // Crepe builds the bar from named groups. Keep the text style selector
                    // and bold and italic, and drop the rest.
                    buildTopBar: (builder) => {
                      const heading = builder.getGroup('heading').group.items.slice()
                      const wanted = builder
                        .getGroup('formatting')
                        .group.items.filter((item) => item.key === 'bold' || item.key === 'italic')
                      builder.clear()
                      const headingGroup = builder.addGroup('heading', 'Text style')
                      heading.forEach((item) => headingGroup.addItem(item.key, item))
                      const formattingGroup = builder.addGroup('formatting', 'Formatting')
                      wanted.forEach((item) => formattingGroup.addItem(item.key, item))
                    },
                  }
                : undefined,
            )
            .addFeature(placeholderFeature, { text: placeholder, mode: 'block' })
            .setReadonly(readOnly)
          nextEditor.on((listener) => {
            listener.markdownUpdated((_context, markdown, previousMarkdown) => {
              if (mounted && markdown !== previousMarkdown) emitMarkdown(markdown)
            })
          })
          return nextEditor.create().then(() => ({ editor: nextEditor, replaceAll }))
        },
      )
        .then((created) => {
          if (created === undefined) return
          if (!mounted) {
            void created.editor.destroy()
            return
          }
          const pendingMarkdown = latestMarkdownRef.current
          if (created.editor.getMarkdown() !== pendingMarkdown) {
            created.editor.editor.action(created.replaceAll(pendingMarkdown, true))
          }
          created.editor.setReadonly(readOnlyRef.current)
          editorRef.current = created.editor
          setReady(true)
        })
        .catch(() => {
          editorRef.current = null
          if (mounted) setEditorError(true)
        })

      return () => {
        mounted = false
        // Milkdown batches markdownUpdated. Flush the current document before
        // changing tabs/turns so the keyed draft cannot lose the final keystrokes.
        const readyEditor = editorRef.current
        if (readyEditor !== null) emitMarkdown(readyEditor.getMarkdown())
        editorRef.current = null
        if (readyEditor !== null) {
          void readyEditor.destroy()
        }
      }
      // A parent keys editors by draft identity. Recreating only on a key change
      // prevents a delayed callback from being routed into another turn's draft.
    }, [])

    useEffect(() => {
      editorRef.current?.setReadonly(readOnly)
    }, [readOnly])

    useEffect(() => {
      const editor = editorRef.current
      if (!ready || editor === null) return
      if (editor.getMarkdown() === value) {
        echoesRef.current.clear()
        return
      }
      if (echoesRef.current.has(value)) return
      echoesRef.current.clear()
      void import('@milkdown/kit/utils').then(({ replaceAll }) => {
        if (editorRef.current === editor) editor.editor.action(replaceAll(value, true))
      })
    }, [ready, value])

    return (
      <div
        className="markdown-editor"
        data-readonly={readOnly ? 'true' : 'false'}
        aria-label={ariaLabel}
        onInputCapture={() => onDirtyRef.current?.()}
      >
        <div ref={rootRef} hidden={!ready} />
        {!ready && (
          <textarea
            className="markdown-editor-fallback"
            aria-label={ariaLabel}
            value={latestMarkdownRef.current}
            readOnly={readOnly}
            placeholder={placeholder}
            onChange={(event) => emitMarkdown(event.target.value)}
          />
        )}
        {!ready && !editorError && <div className="muted editor-status">Loading editor …</div>}
        {editorError && (
          <div className="error editor-status">Rich editing is unavailable; plain Markdown is active.</div>
        )}
      </div>
    )
  },
)
