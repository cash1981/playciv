/**
 * The Private tab of the chat and orders timeline: the viewer's own unlogged
 * `gamenote`, a planning space no other player can read.
 */

import { useRef } from 'react'
import type { MutableRefObject } from 'react'

import { MarkdownEditor } from './MarkdownEditor.js'
import type { MarkdownEditorComponent, MarkdownEditorHandle } from './MarkdownEditor.js'
import './PrivateLogWorkspace.css'

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed'

function SaveStatusBadge({
  status,
  label,
}: {
  readonly status: SaveStatus
  readonly label: string
}): React.JSX.Element {
  const labels: Readonly<Record<SaveStatus, string>> = {
    saved: `Saved ${label}`,
    unsaved: `Unsaved changes: ${label}`,
    saving: `Saving ${label}…`,
    failed: `Save failed: ${label}`,
  }
  return (
    <span className={`save-status save-status-${status}`} role="status">
      <span aria-hidden="true" className="save-status-dot" />
      {labels[status]}
    </span>
  )
}

interface PrivateLogWorkspaceProps {
  readonly note: string
  readonly dirty: boolean
  readonly onChange: (markdown: string) => void
  readonly onDirty?: (() => void) | undefined
  readonly saveStatus?: SaveStatus
  readonly editorRef?: MutableRefObject<MarkdownEditorHandle | null>
  readonly tabPanelId: string
  readonly labelledBy: string
  readonly editorComponent?: MarkdownEditorComponent | undefined
  readonly readOnly?: boolean
}

/** The viewer's existing unlogged `gamenote`, kept separate from public orders. */
export function PrivateLogWorkspace({
  note,
  dirty,
  onChange,
  onDirty,
  saveStatus = dirty ? 'unsaved' : 'saved',
  editorRef: providedEditorRef,
  tabPanelId,
  labelledBy,
  readOnly = false,
  editorComponent: EditorComponent = MarkdownEditor,
}: PrivateLogWorkspaceProps): React.JSX.Element {
  const localEditorRef = useRef<MarkdownEditorHandle>(null)
  const editorRef = providedEditorRef ?? localEditorRef

  return (
    <div role="tabpanel" id={tabPanelId} aria-labelledby={labelledBy}>
      <p className="muted private-log-copy">
        Only you can see this planning space. Saving it does not add an entry to the game log.
      </p>
      <section className="private-log-phase" data-save-status={saveStatus}>
        <div className="private-log-heading">
          <h3>Private log</h3>
          <SaveStatusBadge status={saveStatus} label="Private log" />
        </div>
        <EditorComponent
          key="private-log"
          ref={editorRef}
          value={note}
          onChange={onChange}
          onDirty={onDirty}
          readOnly={readOnly}
          ariaLabel="Private log"
          placeholder="Write private plans and reminders …"
        />
      </section>
    </div>
  )
}
