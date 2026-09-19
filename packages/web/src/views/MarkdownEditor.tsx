import { useEffect, useRef, useState } from 'react'

import { CrepeBuilder } from '@milkdown/crepe/builder'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder as placeholderFeature } from '@milkdown/crepe/feature/placeholder'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { topBar } from '@milkdown/crepe/feature/top-bar'
import '@milkdown/crepe/theme/common/link-tooltip.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import '@milkdown/crepe/theme/common/top-bar.css'
import '@milkdown/crepe/theme/frame.css'
import { replaceAll } from '@milkdown/kit/utils'

interface Props {
  readonly value: string
  readonly onChange: (markdown: string) => void
  readonly readOnly: boolean
  readonly ariaLabel: string
  readonly placeholder?: string
}

/** A controlled Crepe editor whose value is stored as Markdown. */
export function MarkdownEditor({
  value,
  onChange,
  readOnly,
  ariaLabel,
  placeholder = 'Write in Markdown …',
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<CrepeBuilder | null>(null)
  const onChangeRef = useRef(onChange)
  const [ready, setReady] = useState(false)
  const [editorError, setEditorError] = useState(false)

  onChangeRef.current = onChange

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return

    let mounted = true
    let created = false
    const editor = new CrepeBuilder({
      root,
      defaultValue: value,
    })
      .addFeature(listItem)
      .addFeature(linkTooltip)
      .addFeature(toolbar)
      .addFeature(topBar)
      .addFeature(placeholderFeature, { text: placeholder, mode: 'block' })
      .setReadonly(readOnly)

    editor.on((listener) => {
      listener.markdownUpdated((_context, markdown, previousMarkdown) => {
        if (mounted && markdown !== previousMarkdown) onChangeRef.current(markdown)
      })
    })

    editorRef.current = editor
    void editor
      .create()
      .then(() => {
        created = true
        if (!mounted) {
          void editor.destroy()
          return
        }
        setReady(true)
      })
      .catch(() => {
        if (mounted) setEditorError(true)
      })

    return () => {
      mounted = false
      editorRef.current = null
      if (created) void editor.destroy()
    }
    // Recreating an editor on every controlled update loses the cursor. Later
    // prop changes are applied through replaceAll below instead.
  }, [])

  useEffect(() => {
    editorRef.current?.setReadonly(readOnly)
  }, [readOnly])

  useEffect(() => {
    const editor = editorRef.current
    if (!ready || editor === null || editor.getMarkdown() === value) return
    editor.editor.action(replaceAll(value, true))
  }, [ready, value])

  return (
    <div
      className="turn-markdown"
      data-readonly={readOnly ? 'true' : 'false'}
      aria-label={ariaLabel}
    >
      <div ref={rootRef} />
      {editorError && <div className="error">The Markdown editor could not be loaded.</div>}
    </div>
  )
}
