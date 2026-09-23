import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ForwardRefExoticComponent, RefAttributes } from 'react'

import type { CrepeBuilder } from '@milkdown/crepe/builder'

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
    const [ready, setReady] = useState(false)
    const [editorError, setEditorError] = useState(false)

    onChangeRef.current = onChange
    onDirtyRef.current = onDirty
    readOnlyRef.current = readOnly
    if (previousValueRef.current !== value) {
      previousValueRef.current = value
      latestMarkdownRef.current = value
      lastEmittedRef.current = value
    }

    const readMarkdown = (): string => editorRef.current?.getMarkdown() ?? latestMarkdownRef.current

    const emitMarkdown = (markdown: string): void => {
      latestMarkdownRef.current = markdown
      if (markdown === lastEmittedRef.current) return
      lastEmittedRef.current = markdown
      // A read-only editor has no edits to report. Crepe can still serialize
      // the document it was given differently (a trailing newline is enough),
      // and the unmount flush below would otherwise report that as a change —
      // which, for another player's read-only orders, the parent would store
      // as the signed-in player's draft for the same turn.
      if (readOnlyRef.current) return
      onChangeRef.current(markdown)
    }

    useImperativeHandle(ref, () => ({ getMarkdown: readMarkdown }))

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
            .addFeature(topBar)
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
      if (!ready || editor === null || editor.getMarkdown() === value) return
      void import('@milkdown/kit/utils').then(({ replaceAll }) => {
        if (editorRef.current === editor) editor.editor.action(replaceAll(value, true))
      })
    }, [ready, value])

    return (
      <div
        className="turn-markdown"
        data-readonly={readOnly ? 'true' : 'false'}
        aria-label={ariaLabel}
        onInputCapture={() => onDirtyRef.current?.()}
      >
        <div ref={rootRef} hidden={!ready} />
        {!ready && (
          <textarea
            className="turn-markdown-fallback"
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
