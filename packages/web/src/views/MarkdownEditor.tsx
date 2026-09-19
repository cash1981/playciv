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
      readOnly,
      ariaLabel,
      placeholder = 'Write in Markdown …',
    },
    ref,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<CrepeBuilder | null>(null)
    const onChangeRef = useRef(onChange)
    const latestMarkdownRef = useRef(value)
    const lastEmittedRef = useRef(value)
    const previousValueRef = useRef(value)
    const [ready, setReady] = useState(false)
    const [editorError, setEditorError] = useState(false)

    onChangeRef.current = onChange
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
      onChangeRef.current(markdown)
    }

    useImperativeHandle(ref, () => ({ getMarkdown: readMarkdown }))

    useEffect(() => {
      const root = rootRef.current
      if (root === null) return

      let mounted = true
      let created = false
      let editor: CrepeBuilder | null = null

      void Promise.all([
        import('@milkdown/crepe/builder'),
        import('@milkdown/crepe/feature/link-tooltip'),
        import('@milkdown/crepe/feature/list-item'),
        import('@milkdown/crepe/feature/placeholder'),
        import('@milkdown/crepe/feature/toolbar'),
        import('@milkdown/crepe/feature/top-bar'),
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
        ]) => {
          if (!mounted) return undefined
          editor = new CrepeBuilder({
            root,
            defaultValue: latestMarkdownRef.current,
          })
            .addFeature(listItem)
            .addFeature(linkTooltip)
            .addFeature(toolbar)
            .addFeature(topBar)
            .addFeature(placeholderFeature, { text: placeholder, mode: 'block' })
            .setReadonly(readOnly)

          editor.on((listener) => {
            listener.markdownUpdated((_context, markdown, previousMarkdown) => {
              if (mounted && markdown !== previousMarkdown) emitMarkdown(markdown)
            })
          })
          editorRef.current = editor
          return editor.create()
        },
      )
        .then(() => {
          created = true
          if (!mounted) {
            if (editor !== null) void editor.destroy()
            return
          }
          setReady(true)
        })
        .catch(() => {
          if (mounted) setEditorError(true)
        })

      return () => {
        // Milkdown batches markdownUpdated. Flush the current document before
        // changing tabs/turns so the keyed draft cannot lose the final keystrokes.
        if (editor !== null) emitMarkdown(editor.getMarkdown())
        mounted = false
        editorRef.current = null
        if (created && editor !== null) void editor.destroy()
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
