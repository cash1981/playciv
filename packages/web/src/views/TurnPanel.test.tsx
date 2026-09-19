// @vitest-environment jsdom

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlayerTurn, TurnPhase } from '@civ/engine'

import { api } from '../lib/api.js'
import type {
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from './MarkdownEditor.js'
import {
  PrivateLogWorkspace,
  TurnOrderWorkspace,
  TurnTabs,
} from './TurnPanel.js'

const orders: Readonly<Record<TurnPhase, string>> = {
  SOT: '**Build** a city',
  TRADE: 'Trade with blue',
  CM: 'Produce infantry',
  MOVEMENT: 'Move north',
  RESEARCH: 'Research writing',
}

const history: Readonly<Record<TurnPhase, readonly string[]>> = {
  SOT: [],
  TRADE: [],
  CM: [],
  MOVEMENT: [],
  RESEARCH: [],
}

const turn = (username: string, disabled = false): PlayerTurn => ({
  turnNumber: 3,
  username,
  disabled,
  orders,
  history,
})

const noop = (): void => undefined
const run = async (): Promise<void> => undefined

const DelayedEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function DelayedEditor({ value, onChange, readOnly, ariaLabel }, ref) {
    const markdownRef = useRef(value)
    const onChangeRef = useRef(onChange)
    const [, renderVersion] = useState(0)
    onChangeRef.current = onChange
    if (markdownRef.current !== value && readOnly) markdownRef.current = value

    useImperativeHandle(ref, () => ({ getMarkdown: () => markdownRef.current }))

    return (
      <textarea
        aria-label={ariaLabel}
        data-readonly={readOnly ? 'true' : 'false'}
        readOnly={readOnly}
        value={markdownRef.current}
        onChange={(event) => {
          const markdown = event.target.value
          markdownRef.current = markdown
          renderVersion((version) => version + 1)
          setTimeout(() => onChangeRef.current(markdown), 200)
        }}
      />
    )
  },
)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TurnPanel player tabs', () => {
  it('labels every player tab with its username and colour, followed by Private log', () => {
    const markup = renderToStaticMarkup(
      <TurnTabs
        players={[
          { username: 'cash1981', color: 'Red', own: true },
          { username: 'Andrius', color: 'Blue', own: false },
        ]}
        selectedUsername="cash1981"
        privateLogSelected={false}
        showPrivateLog={true}
        onSelectPlayer={noop}
        onSelectPrivateLog={noop}
      />,
    )

    expect(markup).toContain('cash1981')
    expect(markup).toContain('Andrius')
    expect(markup).toContain('Private log')
    expect(markup).toContain('--turn-tab-color:red')
    expect(markup).toContain('--turn-tab-color:blue')
    expect(markup.indexOf('Private log')).toBeGreaterThan(markup.indexOf('Andrius'))
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('aria-controls="turn-orders-player-panel-0"')
  })

  it('supports roving focus and keyboard activation', () => {
    const selected: string[] = []
    render(
      <TurnTabs
        players={[
          { username: 'cash1981', color: 'Red', own: true },
          { username: 'Andrius', color: 'Blue', own: false },
        ]}
        selectedUsername="cash1981"
        privateLogSelected={false}
        showPrivateLog={true}
        onSelectPlayer={(player) => selected.push(player.username)}
        onSelectPrivateLog={() => selected.push('private')}
      />,
    )

    const first = screen.getByRole('tab', { name: 'cash1981' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Andrius' }))
    expect(selected).toEqual(['Andrius'])

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Andrius' }), { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Private log' }))
    expect(selected).toEqual(['Andrius', 'private'])
  })
})

describe('TurnOrderWorkspace', () => {
  it('gives the signed-in player five editable Markdown editors and order actions', () => {
    const markup = renderToStaticMarkup(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        player={{ username: 'cash1981', color: 'Red', own: true }}
        turnNumber={3}
        turnNumbers={[1, 2, 3]}
        current={turn('cash1981')}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
        tabPanelId="panel"
        labelledBy="tab"
      />,
    )

    expect(markup.match(/data-readonly="false"/g)).toHaveLength(5)
    expect(markup.match(/Save /g)).toHaveLength(5)
    expect(markup).toContain('New turn')
    expect(markup).toContain('Lock the turn')
    expect(markup).not.toContain('All orders')
  })

  it('renders another player orders read-only without publishing controls', () => {
    const markup = renderToStaticMarkup(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        player={{ username: 'Andrius', color: 'Blue', own: false }}
        turnNumber={3}
        turnNumbers={[3]}
        current={turn('Andrius')}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
        tabPanelId="panel"
        labelledBy="tab"
      />,
    )

    expect(markup.match(/data-readonly="true"/g)).toHaveLength(5)
    expect(markup).toContain('orders for Andrius, turn 3')
    expect(markup).not.toContain('New turn')
    expect(markup).not.toContain('Lock the turn')
    expect(markup).not.toContain('Save start of turn')
  })

  it('keeps a locked own turn read-only while offering Reopen', () => {
    const markup = renderToStaticMarkup(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        player={{ username: 'cash1981', color: 'Red', own: true }}
        turnNumber={3}
        turnNumbers={[3]}
        current={turn('cash1981', true)}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
        tabPanelId="panel"
        labelledBy="tab"
      />,
    )

    expect(markup.match(/data-readonly="true"/g)).toHaveLength(5)
    expect(markup).toContain('Reopen')
    expect(markup).toContain('Save start of turn')
    expect(markup).toContain('disabled=""')
  })

  it('submits the latest editor document without waiting for the debounced callback', async () => {
    vi.useFakeTimers()
    const updateTurn = vi.spyOn(api, 'updateTurn').mockResolvedValue({} as never)
    const execute = async (action: () => Promise<unknown>): Promise<void> => {
      await action()
    }
    render(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={execute}
        player={{ username: 'cash1981', color: 'Red', own: true }}
        turnNumber={3}
        turnNumbers={[3]}
        current={turn('cash1981')}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
        tabPanelId="panel"
        labelledBy="tab"
        editorComponent={DelayedEditor}
      />,
    )

    fireEvent.change(screen.getByLabelText(/movement orders for cash1981, turn 3/i), {
      target: { value: 'Move immediately' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save movement' }))

    expect(updateTurn).toHaveBeenCalledWith('game-1', 3, 'MOVEMENT', 'Move immediately')
  })

  it('keeps a delayed edit attached to the turn where it was written', () => {
    vi.useFakeTimers()

    function Harness(): React.JSX.Element {
      const [selectedTurn, setSelectedTurn] = useState(1)
      const [drafts, setDrafts] = useState<Record<string, string>>({})
      const values = { ...orders, MOVEMENT: drafts[String(selectedTurn)] ?? '' }
      return (
        <TurnOrderWorkspace
          gameId="game-1"
          busy={false}
          run={run}
          player={{ username: 'cash1981', color: 'Red', own: true }}
          turnNumber={selectedTurn}
          turnNumbers={[1, 2]}
          current={undefined}
          values={values}
          onTurnNumberChange={setSelectedTurn}
          onNewTurn={noop}
          onPhaseChange={(phase, markdown) => {
            if (phase === 'MOVEMENT') {
              setDrafts((current) => ({ ...current, [String(selectedTurn)]: markdown }))
            }
          }}
          tabPanelId="panel"
          labelledBy="tab"
          editorComponent={DelayedEditor}
        />
      )
    }

    render(<Harness />)
    fireEvent.change(screen.getByLabelText(/movement orders for cash1981, turn 1/i), {
      target: { value: 'Turn one movement' },
    })
    fireEvent.change(screen.getByLabelText('Turn for cash1981'), { target: { value: '2' } })
    act(() => vi.advanceTimersByTime(200))

    expect(
      (screen.getByLabelText(/movement orders for cash1981, turn 2/i) as HTMLTextAreaElement).value,
    ).toBe('')
    fireEvent.change(screen.getByLabelText('Turn for cash1981'), { target: { value: '1' } })
    expect(
      (screen.getByLabelText(/movement orders for cash1981, turn 1/i) as HTMLTextAreaElement).value,
    ).toBe('Turn one movement')
  })
})

describe('PrivateLogWorkspace', () => {
  it('describes the note as private and saves it explicitly', () => {
    const markup = renderToStaticMarkup(
      <PrivateLogWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        note="Plan the next research choice"
        dirty={true}
        onChange={noop}
        onSaved={noop}
        tabPanelId="private-panel"
        labelledBy="private-tab"
      />,
    )

    expect(markup).toContain('Only you can see this planning space')
    expect(markup).toContain('does not add an entry to the game log')
    expect(markup).toContain('Save private log')
    expect(markup).toContain('aria-label="Private log"')
    expect(markup).not.toContain('Publish')
  })

  it('does not mark a newer edit clean when an earlier save completes', async () => {
    vi.useFakeTimers()
    let resolveSave: ((value: unknown) => void) | undefined
    vi.spyOn(api, 'saveNote').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }) as never,
    )

    function Harness(): React.JSX.Element {
      const [note, setNote] = useState('Initial')
      const [dirty, setDirty] = useState(true)
      const noteRef = useRef(note)
      const change = (markdown: string): void => {
        noteRef.current = markdown
        setNote(markdown)
        setDirty(true)
      }
      return (
        <PrivateLogWorkspace
          gameId="game-1"
          busy={false}
          run={async (action) => {
            await action()
          }}
          note={note}
          dirty={dirty}
          onChange={change}
          onSaved={(submitted) => {
            if (noteRef.current === submitted) setDirty(false)
          }}
          tabPanelId="private-panel"
          labelledBy="private-tab"
          editorComponent={DelayedEditor}
        />
      )
    }

    render(<Harness />)
    const editor = screen.getByLabelText('Private log')
    fireEvent.change(editor, { target: { value: 'Submitted text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save private log' }))
    fireEvent.change(editor, { target: { value: 'Newer unsaved text' } })

    await act(async () => {
      resolveSave?.({})
      await Promise.resolve()
    })

    expect((screen.getByLabelText('Private log') as HTMLTextAreaElement).value).toBe(
      'Newer unsaved text',
    )
    expect((screen.getByRole('button', { name: 'Save private log' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})
