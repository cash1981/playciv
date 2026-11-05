import { useRef, useState } from 'react'
import type { CancellationCommand } from '@civ/engine'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly?: boolean
  readonly run: Run
}

/** Keep the ID for a retry of the same intent, including a lost network response. */
function useSubmit({ gameId, view, run }: Props) {
  const intent = useRef<{ key: string; id: string } | null>(null)
  return (command: CancellationCommand) => {
    const key = JSON.stringify(command)
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID() }
    const id = intent.current.id
    void run(() => api.cancellation(gameId, command, view.rev, id))
  }
}

export function CancellationCardControl(props: Props & { readonly itemId: string }): React.JSX.Element {
  const [logId, setLogId] = useState('')
  const submit = useSubmit(props)
  const choice = props.view.cancellations?.responseCards.find((c) => c.itemId === props.itemId)
  const pending = props.view.cancellations?.cases.some((c) => c.outcome === 'pending')
  return <div className="play-card-control">
    <p className="muted">Open a cancellation dispute. Nothing is rewound until all players pass the latest response.</p>
    {pending ? <a href="#cancellations">Respond in the cancellation panel</a> : <>
      <label>Action to cancel
        <select value={logId} onChange={(e) => setLogId(e.target.value)} disabled={props.busy || props.readOnly}>
          <option value="">Choose an eligible action</option>
          {choice?.targets.map((t) => <option key={t.logId} value={t.logId} disabled={t.blocked !== null}>{t.text}{t.blocked === null ? '' : ` — ${t.blocked}`}</option>)}
        </select>
      </label>
      <button type="button" disabled={props.busy || props.readOnly || !choice?.targets.some((t) => t.logId === logId && t.blocked === null)}
        onClick={() => submit({ kind: 'open', itemId: props.itemId, logId })}>Open cancellation</button>
      {choice?.targets.length === 0 && <p className="muted">No eligible assisted action. Resource abilities and unrecorded targets require a table-agreed manual correction.</p>}
    </>}
  </div>
}

export function CancellationPanel(props: Props): React.JSX.Element | null {
  const { view, busy, readOnly } = props
  const submit = useSubmit(props)
  const [itemId, setItemId] = useState('')
  const [targetId, setTargetId] = useState('')
  const history = view.cancellations
  if (history === undefined) return null
  const pending = history.cases.find((c) => c.outcome === 'pending')
  const last = history.cases.at(-1)
  const disabled = busy || readOnly || view.you === null || !view.active
  const choice = history.responseCards.find((c) => c.itemId === itemId)
  const response = choice?.responses.find((r) => (r.id ?? 'original') === targetId)
  const seats = [...view.opponents, ...(view.you === null ? [] : [view.you])]
  const username = (id: string) => seats.find((p) => p.playerId === id)?.username ?? id
  return <section className="panel" id="cancellations" aria-label="Cancellations and history confirmation">
    <h2>Cancellations and history confirmation</h2>
    <p>Eligible history starts at turn {history.floorTurn}. Shared confirmed cutoff: {history.sealedThrough}. Current cutoff: {history.cutoff}.</p>
    <p className="muted">Confirm only history you have checked. New actions are not covered by older confirmations. Resolution seals through the dispute so reaction cards cannot be refunded by a later rewind.</p>
    <ul>{history.acknowledgements.map((a) => <li key={a.playerId}>{a.username}: confirmed through {a.through}</li>)}</ul>
    <button type="button" disabled={disabled || pending !== undefined}
      onClick={() => submit({ kind: 'confirm', through: history.cutoff })}>Confirm history through {history.cutoff}</button>
    {pending === undefined && last !== undefined && <p>Last dispute: {last.outcome}. {last.target}</p>}
    {history.cases.some((c) => c.outcome !== 'pending') && <details>
      <summary>Resolved disputes</summary>
      {history.cases.filter((c) => c.outcome !== 'pending').map((c) => <div key={c.id}>
        <h3>{c.outcome}: {c.target}</h3>
        <ol>{c.reactions.map((r) => <li key={r.id}>
          {username(r.playerId)}: {r.name}{r.protection ? ' — protection; Twain stays in hand' : r.targetId === null ? ' — original action' : ` — counter to ${c.reactions.find((t) => t.id === r.targetId)?.name ?? r.targetId}`}
        </li>)}</ol>
        <p>{c.outcome === 'cancelled' ? 'Superseded later history (orders retained for revision):' : 'Original continuation retained:'}</p>
        <ul>{c.affected.map((text, i) => <li key={i}>{text}</li>)}</ul>
      </div>)}
    </details>}
    {view.you?.playerTurns.some((t) => t.needsRevision) && <p role="status">Retained orders need revision after rollback. Review and repost affected phases before carrying them out.</p>}
    {pending !== undefined && <>
      <h3>Gameplay paused — order-only flow</h3>
      <p role="status">Chat, private notes and order drafts remain available. Do not carry out orders, draw cards or move pieces until this dispute settles.</p>
      <p>Target: {pending.target}</p>
      <details><summary>Later assisted actions that would be superseded ({pending.affected.length})</summary>
        <ul>{pending.affected.map((text, i) => <li key={i}>{text}</li>)}</ul>
      </details>
      <ol>{pending.reactions.map((r) => <li key={r.id}>{username(r.playerId)}: {r.name} — {r.protection ? 'protection (Twain stays in hand)' : r.targetId === null ? 'original action' : `counter to ${pending.reactions.find((t) => t.id === r.targetId)?.name ?? r.targetId}`}</li>)}</ol>
      <p>Waiting for: {pending.participants.filter((id) => !pending.passes.includes(id)).map(username).join(', ') || 'settlement'} (response version {pending.version})</p>
      <button type="button" disabled={disabled || pending.passes.includes(view.you?.playerId ?? '')}
        onClick={() => submit({ kind: 'pass', caseId: pending.id, version: pending.version })}>Pass on version {pending.version}</button>
      {view.you !== null && <>
        <label>Your response card
          <select value={itemId} disabled={disabled} onChange={(e) => { setItemId(e.target.value); setTargetId('') }}>
            <option value="">Choose a card, or pass</option>
            {history.responseCards.filter((c) => c.responses.length > 0).map((c) => <option key={c.itemId} value={c.itemId}>{c.name}</option>)}
          </select>
        </label>
        <label>Response target
          <select value={targetId} disabled={disabled} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a target</option>
            {choice?.responses.map((r) => <option key={r.id ?? 'original'} value={r.id ?? 'original'}>{r.label}</option>)}
          </select>
        </label>
        <button type="button" disabled={disabled || response === undefined}
          onClick={() => { if (response !== undefined) submit({ kind: 'respond', caseId: pending.id, version: pending.version, itemId, targetId: response.id }) }}>Respond</button>
        <p className="muted">The server checks that your chosen card was available before the original action as well as now. Every response resets everyone’s passes.</p>
      </>}
    </>}
  </section>
}
