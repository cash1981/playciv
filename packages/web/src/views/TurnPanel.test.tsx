// @vitest-environment jsdom

import { createRef, forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlayerTurn, TurnPhase } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { MarkdownEditor } from './MarkdownEditor.js'
import type {
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from './MarkdownEditor.js'
import {
  PrivateLogWorkspace,
  TurnPanel,
  TurnOrderWorkspace,
  TurnTabs,
} from './TurnPanel.js'

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

const revealed: Readonly<Record<TurnPhase, boolean>> = {
  SOT: false,
  TRADE: false,
  CM: false,
  MOVEMENT: false,
  RESEARCH: false,
}

const turn = (
  username: string,
  disabled = false,
  turnNumber = 3,
  turnOrders: Readonly<Record<TurnPhase, string>> = orders,
): PlayerTurn => ({
  turnNumber,
  username,
  disabled,
  orders: turnOrders,
  revealed,
  history,
})

const noop = (): void => undefined
const run = async (): Promise<void> => undefined

const DelayedEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function DelayedEditor({ value, onChange, onDirty, readOnly, ariaLabel }, ref) {
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
          onDirty?.()
          setTimeout(() => onChangeRef.current(markdown), 200)
        }}
      />
    )
  },
)

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
    await waitFor(() => expect(milkdownLifecycle.instances).toHaveLength(1))
    unmount()
    expect(milkdownLifecycle.getMarkdownCalls).toBe(0)

    await act(async () => {
      resolveCreate?.()
      await Promise.resolve()
    })
    await waitFor(() => expect(milkdownLifecycle.instances[0]?.destroyed).toBe(true))
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

    expect(
      await screen.findByText('Rich editing is unavailable; plain Markdown is active.'),
    ).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Rejected editor' }), {
      target: { value: 'Fallback Markdown' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save rejected editor' }))

    expect(saved).toEqual(['Fallback Markdown'])
    expect(milkdownLifecycle.getMarkdownCalls).toBe(0)
  })
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
    expect(markup).toContain('New turn')
    expect(markup).toContain('Lock the turn')
    expect(markup.match(/Saved (start of turn|trade|city management|movement|research)/g)).toHaveLength(5)
    expect(markup).not.toContain('Save start of turn')
    expect(markup).not.toContain('All orders')
  })

  it('offers one reveal button for each populated private phase', () => {
    const onRevealPhase = vi.fn()
    render(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
        player={{ username: 'cash1981', color: 'Red', own: true }}
        turnNumber={3}
        turnNumbers={[3]}
        current={turn('cash1981')}
        values={orders}
        onTurnNumberChange={noop}
        onNewTurn={noop}
        onPhaseChange={noop}
        onRevealPhase={onRevealPhase}
        tabPanelId="panel"
        labelledBy="tab"
        editorComponent={DelayedEditor}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Reveal' })).toHaveLength(5)
    fireEvent.click(screen.getAllByRole('button', { name: 'Reveal' })[0] as HTMLElement)
    expect(onRevealPhase).toHaveBeenCalledWith('SOT')
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
    expect(markup).not.toContain('Save start of turn')
  })

  it('shows each phase save status without per-phase save buttons', () => {
    vi.useFakeTimers()
    render(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
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

    expect(screen.getAllByText(/^Saved (start of turn|trade|city management|movement|research)$/)).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Save movement' })).toBeNull()
  })

  it('maps keyed phase statuses to the matching phase border and badge', () => {
    render(
      <TurnOrderWorkspace
        gameId="game-1"
        busy={false}
        run={run}
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
        phaseStatuses={{
          SOT: 'saved',
          TRADE: 'saving',
          CM: 'saved',
          MOVEMENT: 'failed',
          RESEARCH: 'unsaved',
        }}
        editorComponent={DelayedEditor}
      />,
    )

    expect(screen.getByText('Saving trade…').closest('section')?.dataset['saveStatus']).toBe('saving')
    expect(screen.getByText('Save failed: movement').closest('section')?.dataset['saveStatus']).toBe(
      'failed',
    )
    expect(screen.getByText('Unsaved changes: research').closest('section')?.dataset['saveStatus']).toBe(
      'unsaved',
    )
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
        note="Plan the next research choice"
        dirty={true}
        onChange={noop}
        tabPanelId="private-panel"
        labelledBy="private-tab"
      />,
    )

    expect(markup).toContain('Only you can see this planning space')
    expect(markup).toContain('does not add an entry to the game log')
    expect(markup).toContain('Private log')
    expect(markup).toContain('Unsaved changes: Private log')
    expect(markup).toContain('class="turn-phase private-log-phase" data-save-status="unsaved"')
    expect(markup).toContain('aria-label="Private log"')
    expect(markup).not.toContain('Publish')
  })

})

describe('TurnPanel save all changes', () => {
  const viewFor = (
    ownTurns: readonly PlayerTurn[] = [turn('cash1981', false, 1)],
    opponents: PlayerView['opponents'] = [],
    gamenote: string | null = null,
  ): PlayerView =>
    ({
      you: {
        username: 'cash1981',
        color: 'Red',
        playernumber: 1,
        gamenote,
        playerTurns: ownTurns,
      },
      opponents,
    }) as unknown as PlayerView

  const runIgnoringAggregateError = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch {
      // TurnPanel exposes the aggregate error through the real GameView runner.
    }
  }

  it('publishes the latest text from every changed phase with one button', async () => {
    const playerView = viewFor()
    const updateTurn = vi.spyOn(api, 'updateTurn').mockResolvedValue(playerView)
    vi.spyOn(api, 'game').mockResolvedValue(playerView)
    vi.spyOn(api, 'publicTurns').mockResolvedValue([])

    render(
      <TurnPanel
        gameId="game-1"
        busy={false}
        run={runIgnoringAggregateError}
        reloadCount={0}
        editorComponent={DelayedEditor}
      />,
    )

    const saveAll = await screen.findByRole('button', { name: 'Save all changes' })
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('textbox', { name: /movement orders.*turn 1/i }), {
      target: { value: 'Move immediately' },
    })
    expect((saveAll as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save all changes' }))
    await act(async () => Promise.resolve())

    expect(updateTurn).toHaveBeenCalledWith('game-1', 1, 'MOVEMENT', 'Move immediately')
    act(() => vi.advanceTimersByTime(200))
    expect((saveAll as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Saved movement')).toBeTruthy()
  })

  it('never reads an opponent editor while saving an own-turn draft', async () => {
    const playerView = viewFor([], [
      { username: 'Andrius', color: 'Blue', playernumber: 2 } as PlayerView['opponents'][number],
    ])
    const ownTurn = turn('cash1981', false, 1, { ...orders, MOVEMENT: 'Own baseline' })
    const loadedView = viewFor([ownTurn], playerView.opponents)
    const opponentTurn = turn('Andrius', false, 1, {
      ...orders,
      MOVEMENT: 'Opponent private strategy',
    })
    const updateTurn = vi.spyOn(api, 'updateTurn').mockResolvedValue(loadedView)
    vi.spyOn(api, 'game').mockResolvedValue(loadedView)
    vi.spyOn(api, 'publicTurns').mockResolvedValue([opponentTurn])

    render(
      <TurnPanel
        gameId="game-1"
        busy={false}
        run={runIgnoringAggregateError}
        reloadCount={0}
        editorComponent={DelayedEditor}
      />,
    )

    await screen.findByRole('tab', { name: 'Andrius' })
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('textbox', { name: /movement orders for cash1981.*turn 1/i }), {
      target: { value: 'Own new movement' },
    })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.click(screen.getByRole('tab', { name: 'Andrius' }))
    expect(
      (screen.getByRole('textbox', {
        name: /movement orders for Andrius.*turn 1/i,
      }) as HTMLTextAreaElement).value,
    ).toBe('Opponent private strategy')
    fireEvent.click(screen.getByRole('button', { name: 'Save all changes' }))
    await act(async () => Promise.resolve())

    expect(updateTurn).toHaveBeenCalledWith('game-1', 1, 'MOVEMENT', 'Own new movement')
    expect(updateTurn).not.toHaveBeenCalledWith(
      'game-1',
      1,
      'MOVEMENT',
      'Opponent private strategy',
    )
  })

  it('removes successful drafts so a retry only sends the failed phase', async () => {
    const playerView = viewFor()
    let failMovement = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const updateTurn = vi
      .spyOn(api, 'updateTurn')
      .mockImplementation(async (_gameId, _turnNumber, phase) => {
        if (phase === 'MOVEMENT' && failMovement) throw new Error('movement failed')
        return playerView
      })
    vi.spyOn(api, 'game').mockResolvedValue(playerView)
    vi.spyOn(api, 'publicTurns').mockResolvedValue([])

    render(
      <TurnPanel
        gameId="game-1"
        busy={false}
        run={runIgnoringAggregateError}
        reloadCount={0}
        editorComponent={DelayedEditor}
      />,
    )

    await screen.findByRole('button', { name: 'Save all changes' })
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('textbox', { name: /start of turn orders.*turn 1/i }), {
      target: { value: 'New setup' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: /movement orders.*turn 1/i }), {
      target: { value: 'New movement' },
    })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.click(screen.getByRole('button', { name: 'Save all changes' }))
    expect(screen.getByText('Saving start of turn…')).toBeTruthy()
    expect(screen.getByText('Saving movement…')).toBeTruthy()
    await act(async () => Promise.resolve())
    await act(async () => Promise.resolve())

    expect(screen.getByText('Saved start of turn')).toBeTruthy()
    expect(screen.getByText('Save failed: movement')).toBeTruthy()
    failMovement = false
    fireEvent.click(screen.getByRole('button', { name: 'Save all changes' }))
    await act(async () => Promise.resolve())
    await act(async () => Promise.resolve())

    expect(updateTurn.mock.calls.filter((call) => call[2] === 'SOT')).toHaveLength(1)
    expect(updateTurn.mock.calls.filter((call) => call[2] === 'MOVEMENT')).toHaveLength(2)
    expect(screen.getByText('Saved movement')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save all changes' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('keeps a revert made during an in-flight save as an unsaved change', async () => {
    const playerView = viewFor()
    let resolveUpdate: ((view: PlayerView) => void) | undefined
    const updateTurn = vi.spyOn(api, 'updateTurn').mockImplementation(
      () =>
        new Promise<PlayerView>((resolve) => {
          resolveUpdate = resolve
        }),
    )
    vi.spyOn(api, 'game').mockResolvedValue(playerView)
    vi.spyOn(api, 'publicTurns').mockResolvedValue([])

    render(
      <TurnPanel
        gameId="game-1"
        busy={false}
        run={runIgnoringAggregateError}
        reloadCount={0}
        editorComponent={DelayedEditor}
      />,
    )

    const editor = await screen.findByRole('textbox', { name: /movement orders.*turn 1/i })
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'New movement' } })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.click(screen.getByRole('button', { name: 'Save all changes' }))
    fireEvent.change(editor, { target: { value: orders.MOVEMENT } })
    act(() => vi.advanceTimersByTime(200))

    await act(async () => {
      resolveUpdate?.(playerView)
      await Promise.resolve()
    })

    expect(screen.getByText('Unsaved changes: movement')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save all changes' }))
    expect(updateTurn).toHaveBeenCalledTimes(2)
    expect(updateTurn.mock.calls[1]).toEqual(['game-1', 1, 'MOVEMENT', orders.MOVEMENT])
  })

  it('marks the private log unsaved when it changes during an in-flight save', async () => {
    const playerView = viewFor()
    let resolveSave: ((view: PlayerView) => void) | undefined
    vi.spyOn(api, 'game').mockResolvedValue(playerView)
    vi.spyOn(api, 'publicTurns').mockResolvedValue([])
    vi.spyOn(api, 'saveNote').mockImplementation(
      () =>
        new Promise<PlayerView>((resolve) => {
          resolveSave = resolve
        }),
    )

    render(
      <TurnPanel
        gameId="game-1"
        busy={false}
        run={runIgnoringAggregateError}
        reloadCount={0}
        editorComponent={DelayedEditor}
      />,
    )

    fireEvent.click(await screen.findByRole('tab', { name: 'Private log' }))
    vi.useFakeTimers()
    const editor = screen.getByRole('textbox', { name: 'Private log' })
    fireEvent.change(editor, { target: { value: 'Submitted note' } })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.click(screen.getByRole('button', { name: 'Save all changes' }))
    fireEvent.change(editor, { target: { value: 'Newer unsaved note' } })
    await act(async () => {
      resolveSave?.(playerView)
      await Promise.resolve()
    })

    expect(screen.getByText('Unsaved changes: Private log')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save all changes' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('disables locking and enables beforeunload on the first editor input', async () => {
    const playerView = viewFor()
    vi.spyOn(api, 'game').mockResolvedValue(playerView)
    vi.spyOn(api, 'publicTurns').mockResolvedValue([])

    render(
      <TurnPanel
        gameId="game-1"
        busy={false}
        run={runIgnoringAggregateError}
        reloadCount={0}
        editorComponent={DelayedEditor}
      />,
    )

    const lock = await screen.findByRole('button', { name: 'Lock the turn' })
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('textbox', { name: /movement orders.*turn 1/i }), {
      target: { value: 'Not emitted yet' },
    })

    expect((lock as HTMLButtonElement).disabled).toBe(true)
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
  })

  it('vetoes SPA navigation when changes are unsaved', async () => {
    const playerView = viewFor()
    vi.spyOn(api, 'game').mockResolvedValue(playerView)
    vi.spyOn(api, 'publicTurns').mockResolvedValue([])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <TurnPanel
        gameId="game-1"
        busy={false}
        run={runIgnoringAggregateError}
        reloadCount={0}
        editorComponent={DelayedEditor}
      />,
    )

    const editor = await screen.findByRole('textbox', { name: /movement orders.*turn 1/i })
    vi.useFakeTimers()
    fireEvent.change(editor, {
      target: { value: 'Not saved' },
    })
    const detail = { allowed: true }
    window.dispatchEvent(new CustomEvent('civ:navigation-attempt', { detail }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(detail.allowed).toBe(false)
  })
})
