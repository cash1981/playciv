// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { forwardRef, useImperativeHandle } from 'react'
import { TURN_PHASE_LABEL } from '@civ/engine'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TurnPhase } from '@civ/engine'

import { api } from '../lib/api.js'
import type { ChatPageDto, PlayerView, TimelineMessageDto } from '../lib/api.js'
import {
  ChatOrdersPanel,
  turnTitle,
  firstOpenPhase,
  strikeThrough,
  viewerTurn,
  mergeTimeline,
  outOfTurnQuestion,
  replacedOrderIds,
  TurnStatusStrip,
} from './ChatOrdersPanel.js'
import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor.js'

// The real module stays for `ApiError`, which `errorMessage` tests with instanceof
vi.mock('../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.js')>()),
  api: {
    chatPage: vi.fn(),
    sendChat: vi.fn(),
    postOrder: vi.fn(),
    markDone: vi.fn(),
    unmarkDone: vi.fn(),
    saveNote: vi.fn(),
    sendTradeOffer: vi.fn(),
    transitionTradeOffer: vi.fn(),
    counterTradeOffer: vi.fn(),
  },
}))

const chatPage = vi.mocked(api.chatPage)
const sendChat = vi.mocked(api.sendChat)
const postOrder = vi.mocked(api.postOrder)
const markDone = vi.mocked(api.markDone)
const unmarkDone = vi.mocked(api.unmarkDone)
const saveNote = vi.mocked(api.saveNote)
const sendTradeOffer = vi.mocked(api.sendTradeOffer)
const transitionTradeOffer = vi.mocked(api.transitionTradeOffer)
const counterTradeOffer = vi.mocked(api.counterTradeOffer)

/** A controlled textarea standing in for the Milkdown editor. */
const FakeEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function FakeEditor({ value, onChange, readOnly, ariaLabel, toolbar }, ref) {
    useImperativeHandle(ref, () => ({ getMarkdown: () => value }))
    return (
      <textarea
        aria-label={ariaLabel}
        data-toolbar={toolbar}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  },
)

const run = async (action: () => Promise<unknown>): Promise<void> => {
  await action()
}

const PHASES: readonly TurnPhase[] = ['SOT', 'TRADE', 'CM', 'MOVEMENT', 'RESEARCH']

const doneUpTo = (last: TurnPhase | null): Record<TurnPhase, boolean> => {
  const count = last === null ? 0 : PHASES.indexOf(last) + 1
  return {
    SOT: count > 0,
    TRADE: count > 1,
    CM: count > 2,
    MOVEMENT: count > 3,
    RESEARCH: count > 4,
  }
}

const seat = (username: string, playernumber: number, overrides: Record<string, unknown> = {}) => ({
  playerId: `id-${username}`,
  username,
  color: null,
  civilization: null,
  playernumber,
  yourTurn: false,
  ...overrides,
})

interface ViewOptions {
  readonly you?: Record<string, unknown> | null
  readonly opponents?: readonly Record<string, unknown>[]
  readonly activeTurn?: Record<string, unknown> | null
  readonly tradeOffers?: readonly Record<string, unknown>[]
}

/**
 * Only the fields the panel reads. The viewer is on turn 4 with Start of turn
 * and Trade done, waiting on City management.
 */
function makeView(options: ViewOptions = {}): PlayerView {
  const you =
    options.you === undefined
      ? seat('Alice', 1, {
          gamenote: 'my private plan',
          playerTurns: [
            { turnNumber: 3, done: doneUpTo('RESEARCH') },
            { turnNumber: 4, done: doneUpTo('TRADE') },
          ],
        })
      : options.you
  return {
    rev: 17,
    you,
    opponents: options.opponents ?? [seat('Bob', 2, { color: 'Blue' })],
    activeTurn:
      options.activeTurn === undefined
        ? {
            playerId: 'id-Alice',
            username: 'Alice',
            turnNumber: 4,
            phase: 'CM',
            startPlayer: 'Bob',
            waitingFor: [
              { username: 'Alice', phase: 'CM' },
              { username: 'Bob', phase: 'SOT' },
          ],
        }
      : options.activeTurn,
    tradeOffers: options.tradeOffers ?? [],
  } as unknown as PlayerView
}

const message = (id: string, overrides: Partial<TimelineMessageDto> = {}): TimelineMessageDto => ({
  id,
  username: 'Bob',
  message: `text of ${id}`,
  createdAt: `2026-01-01T10:00:0${id.length}Z`,
  kind: 'chat',
  turnNumber: null,
  phase: null,
  ...overrides,
})

const tradeOffer = (overrides: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  senderId: 'id-Alice',
  senderUsername: 'Alice',
  recipientId: 'id-Bob',
  recipientUsername: 'Bob',
  terms: 'two trade for one wheat',
  turnNumber: 4,
  phase: 'TRADE',
  status: 'pending',
  parentOfferId: null,
  createdAt: null,
  resolvedAt: null,
  logId: 'log-1',
  ...overrides,
})

const page = (messages: readonly TimelineMessageDto[], hasMore = false): ChatPageDto => ({ messages, hasMore })

async function renderPanel(
  view: PlayerView,
  props: { readOnly?: boolean; autoRefresh?: boolean; reloadCount?: number } = {},
): Promise<ReturnType<typeof render>> {
  let result: ReturnType<typeof render> | undefined
  await act(async () => {
    result = render(
      <ChatOrdersPanel
        gameId="game"
        view={view}
        busy={false}
        readOnly={props.readOnly ?? false}
        run={run}
        reloadCount={props.reloadCount ?? 0}
        autoRefresh={props.autoRefresh ?? false}
        editorComponent={FakeEditor}
        authors={
          new Map([
            ['Alice', { civilization: 'Romans', color: 'Red' }],
            ['Bob', { civilization: 'Greeks', color: 'Blue' }],
          ])
        }
      />,
    )
  })
  if (result === undefined) throw new Error('panel did not render')
  return result
}

const rows = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('.chat-orders-message')).map(
    (row) => row.querySelector('.chat-orders-body')?.textContent ?? row.textContent ?? '',
  )

const filterChip = (name: string): HTMLElement =>
  within(screen.getByRole('tablist', { name: 'Show' })).getByRole('tab', { name })

const click = async (element: HTMLElement): Promise<void> => {
  await act(async () => { fireEvent.click(element) })
}

const type = async (label: string, text: string): Promise<void> => {
  await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value: text } }) })
}

beforeEach(() => {
  localStorage.setItem('civ.panel.chat-orders', 'true')
  chatPage.mockResolvedValue(page([]))
  sendChat.mockResolvedValue({ id: 'sent', username: 'Alice', message: '', createdAt: '' })
  postOrder.mockResolvedValue(makeView())
  markDone.mockResolvedValue(makeView())
  unmarkDone.mockResolvedValue(makeView())
  saveNote.mockResolvedValue(makeView())
  sendTradeOffer.mockResolvedValue(makeView())
  transitionTradeOffer.mockResolvedValue(makeView())
  counterTradeOffer.mockResolvedValue(makeView())
})

afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.chat-orders')
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the timeline', () => {
  it('shows the oldest message first and the composer below the messages', async () => {
    chatPage.mockResolvedValue(page([message('a'), message('bb'), message('ccc')]))
    const { container } = await renderPanel(makeView())

    expect(rows(container)).toEqual(['text of a', 'text of bb', 'text of ccc'])
    const log = screen.getByRole('log', { name: 'Timeline' })
    const composer = container.querySelector('.chat-orders-composer')
    if (composer === null) throw new Error('composer missing')
    // The log comes before the composer in the document
    expect(log.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chatPage).toHaveBeenCalledWith('game')
  })

  it('shows the civ, the coloured nickname and the time on a message', async () => {
    chatPage.mockResolvedValue(page([message('a')]))
    const { container } = await renderPanel(makeView())

    const row = container.querySelector('.chat-orders-message')
    // Read as "Greeks - Bob", in one box, civ and nickname both in the player's colour
    expect(row?.querySelector('.chat-orders-author')?.textContent).toBe('Greeks - Bob')
    // The civ is small, beside the coloured nickname
    expect(row?.querySelector('.chat-orders-author > small')?.className).toBe('player-blue')
    expect(row?.querySelector('strong')?.textContent).toBe('Bob')
    expect(row?.querySelector('strong')?.className).toBe('player-blue')
    expect(row?.className).toContain('player-blue')
    expect(row?.querySelector('time')).not.toBeNull()
  })

  it('tags an order with its turn and phase and shows a system row quietly', async () => {
    chatPage.mockResolvedValue(page([
      message('a', { kind: 'order', turnNumber: 4, phase: 'SOT', message: 'Build a city' }),
      message('bb', { kind: 'system', username: 'Bob', message: 'Bob marked SOT done' }),
    ]))
    const { container } = await renderPanel(makeView())

    const order = container.querySelector('[data-kind="order"]')
    expect(order?.querySelector('.tag.turn')?.textContent).toBe('T4 · SOT')
    const system = container.querySelector('.chat-orders-system')
    expect(system?.textContent).toContain('Bob marked SOT done')
    expect(system?.querySelector('strong')).toBeNull()
  })

  it('adds a refresh to what is held, by id, without duplicates', async () => {
    vi.useFakeTimers()
    chatPage
      .mockResolvedValueOnce(page([message('a'), message('bb')]))
      .mockResolvedValueOnce(page([message('a'), message('bb'), message('ccc')]))
    const { container } = await renderPanel(makeView(), { autoRefresh: true })
    expect(rows(container)).toEqual(['text of a', 'text of bb'])

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })

    expect(rows(container)).toEqual(['text of a', 'text of bb', 'text of ccc'])
  })

  it('says in the panel whether auto-refresh is on', async () => {
    const on = await renderPanel(makeView(), { autoRefresh: true })
    expect(on.container.querySelector('.auto-refresh-status')?.textContent).toBe('Auto-refresh on')
    cleanup()
    const off = await renderPanel(makeView(), { autoRefresh: false })
    expect(off.container.querySelector('.auto-refresh-status')?.textContent).toBe('Auto-refresh off')
  })

  it('stops polling when auto-refresh is off', async () => {
    vi.useFakeTimers()
    chatPage.mockResolvedValue(page([message('a')]))
    await renderPanel(makeView(), { autoRefresh: false })

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })

    expect(chatPage).toHaveBeenCalledTimes(1)
  })

  it('drops the answer of an older request that completes after a newer one', async () => {
    let finishOld: ((first: ChatPageDto) => void) | undefined
    chatPage
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce(page([message('new', { message: 'new row' })]))
    const { container, rerender } = await renderPanel(makeView())

    await act(async () => {
      rerender(
        <ChatOrdersPanel
          gameId="game" view={makeView()} busy={false} readOnly={false} run={run}
          reloadCount={1} autoRefresh={false} editorComponent={FakeEditor}
        />,
      )
    })
    expect(rows(container)).toEqual(['new row'])

    await act(async () => { finishOld?.(page([message('old', { message: 'old row' })], true)) })

    expect(rows(container)).toEqual(['new row'])
    expect(chatPage).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('keeps older turns that were loaded when a refresh only carries the newest', async () => {
    chatPage
      .mockResolvedValueOnce(page([message('cc'), message('ddd')], true))
      .mockResolvedValueOnce(page([message('a'), message('bb')], false))
      .mockResolvedValueOnce(page([message('cc'), message('ddd'), message('eeee')], true))
    const { container, rerender } = await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Load more' }))
    expect(rows(container)).toEqual(['text of a', 'text of bb', 'text of cc', 'text of ddd'])

    await act(async () => {
      rerender(
        <ChatOrdersPanel
          gameId="game" view={makeView()} busy={false} readOnly={false} run={run}
          reloadCount={1} autoRefresh={false} editorComponent={FakeEditor}
        />,
      )
    })

    expect(rows(container)).toEqual(['text of a', 'text of bb', 'text of cc', 'text of ddd', 'text of eeee'])
    // The refresh says there is more, but the older turn is already on screen
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})

describe('trade offers', () => {
  it('submits free-text terms and clears the draft after success', async () => {
    await renderPanel(makeView())
    await type('Terms', ' two trade for one wheat ')
    await click(screen.getByRole('button', { name: 'Send offer' }))

    expect(sendTradeOffer).toHaveBeenCalledWith('game', 'id-Bob', 'two trade for one wheat', expect.any(String), 17)
    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps an unsent draft when the view refreshes', async () => {
    const { rerender } = await renderPanel(makeView())
    await type('Terms', 'save this draft')

    await act(async () => {
      rerender(
        <ChatOrdersPanel
          gameId="game" view={{ ...makeView(), rev: 18 }} busy={false} readOnly={false} run={run}
          reloadCount={1} autoRefresh={false} editorComponent={FakeEditor}
        />,
      )
    })

    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('save this draft')
  })

  it('shows acceptance only for the recipient and withdrawal only for the sender', async () => {
    await renderPanel(makeView({ tradeOffers: [tradeOffer()] }))
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()

    cleanup()
    await renderPanel(makeView({
      you: seat('Bob', 2, { playerTurns: [] }),
      opponents: [seat('Alice', 1)],
      tradeOffers: [tradeOffer()],
    }))
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Counter' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
  })

  it('sends a linked counteroffer from the intended offer row', async () => {
    await renderPanel(makeView({
      you: seat('Bob', 2, { playerTurns: [] }),
      opponents: [seat('Alice', 1)],
      tradeOffers: [tradeOffer()],
    }))
    await click(screen.getByRole('button', { name: 'Counter' }))
    await type('Counteroffer terms', 'one trade for two wheat')
    await click(screen.getByRole('button', { name: 'Send counteroffer' }))

    expect(counterTradeOffer).toHaveBeenCalledWith('game', 'offer-1', 'one trade for two wheat', expect.any(String), 17)
  })

  it('explains that acceptance records agreement but does not settle resources', async () => {
    await renderPanel(makeView())
    expect(screen.getByText(/Accepting records that you agreed to the terms/)).toBeTruthy()
    expect(screen.getByText(/does not transfer resources/)).toBeTruthy()
  })
})

describe('the row that starts a turn', () => {
  const divider = message('dd', {
    kind: 'system',
    turnNumber: 2,
    phase: 'SOT',
    message: 'Turn 2: Bob starts with the Start of turn phase',
  })

  it('is a divider, not an ordinary system line', async () => {
    chatPage.mockResolvedValue(page([
      message('a', { kind: 'system', turnNumber: 1, phase: 'RESEARCH', message: 'Turn 1 - Bob marked all phases up to research done' }),
      divider,
      message('ccc', { message: 'first talk of turn 2' }),
    ]))
    const { container } = await renderPanel(makeView())

    const dividers = container.querySelectorAll('.chat-orders-divider')
    expect(dividers).toHaveLength(1)
    expect(dividers[0]?.textContent).toBe('Turn 2: Bob starts with the Start of turn phase')
    // The done line beside it stays an ordinary quiet system row
    expect(container.querySelectorAll('.chat-orders-system')).toHaveLength(1)
    expect(rows(container)).toHaveLength(3)
  })

  it('needs the turn tag, the phase and the exact wording, so chat cannot forge one', async () => {
    chatPage.mockResolvedValue(page([
      message('a', { message: 'Turn 9: Bob starts with the Start of turn phase' }),
      message('bb', { kind: 'system', turnNumber: 3, phase: 'TRADE', message: 'Turn 3: Bob starts with the Start of turn phase' }),
      message('ccc', { kind: 'system', turnNumber: 2, phase: 'SOT', message: 'Turn 2 - Bob marked start of turn phase done' }),
    ]))
    const { container } = await renderPanel(makeView())
    expect(container.querySelector('.chat-orders-divider')).toBeNull()
  })

  it('shows under Orders and All but not under Chat', async () => {
    chatPage.mockResolvedValue(page([divider, message('ccc', { message: 'hello' })]))
    const { container } = await renderPanel(makeView())
    await click(filterChip('Orders'))
    expect(container.querySelector('.chat-orders-divider')).not.toBeNull()
    await click(filterChip('Chat'))
    expect(container.querySelector('.chat-orders-divider')).toBeNull()
  })
})

describe('mergeTimeline', () => {
  const ids = (list: readonly TimelineMessageDto[]): string[] => list.map((row) => row.id)

  it('puts an older page in front and new rows at the end, whatever the timestamps say', () => {
    const held = [message('m2'), message('m3')]
    // Timestamps deliberately upside down: the server's order is the one kept
    const older = [
      message('m0', { createdAt: '2030-01-01T00:00:00Z' }),
      message('m1', { createdAt: '2000-01-01T00:00:00Z' }),
    ]
    expect(ids(mergeTimeline(held, older))).toEqual(['m0', 'm1', 'm2', 'm3'])
    expect(ids(mergeTimeline(held, [message('m3'), message('m4')]))).toEqual(['m2', 'm3', 'm4'])
  })

  it('refreshes a row it already holds and never mutates its input', () => {
    const held = [message('m1', { message: 'old' })]
    const merged = mergeTimeline(held, [message('m1', { message: 'new' })])
    expect(merged.map((row) => row.message)).toEqual(['new'])
    expect(held[0]?.message).toBe('old')
  })
})

describe('filter chips', () => {
  const mixed = [
    message('a', { message: 'just talking' }),
    message('bb', { kind: 'order', turnNumber: 4, phase: 'TRADE', message: 'trade order' }),
    message('ccc', { kind: 'system', message: 'Bob marked Trade done' }),
  ]

  it('shows everything under All, and orders with their system lines under Orders', async () => {
    chatPage.mockResolvedValue(page(mixed))
    const { container } = await renderPanel(makeView())
    expect(rows(container)).toHaveLength(3)

    await click(filterChip('Orders'))
    expect(container.textContent).not.toContain('just talking')
    expect(container.textContent).toContain('trade order')
    expect(container.textContent).toContain('Bob marked Trade done')
  })

  it('shows only plain chat under Chat', async () => {
    chatPage.mockResolvedValue(page(mixed))
    const { container } = await renderPanel(makeView())

    await click(filterChip('Chat'))

    expect(rows(container)).toEqual(['just talking'])
    expect(filterChip('Chat').getAttribute('aria-selected')).toBe('true')
  })
})

describe('replaced orders', () => {
  const twice = [
    message('a', { username: 'Bob', kind: 'order', turnNumber: 4, phase: 'TRADE', message: 'first draft' }),
    message('bb', { username: 'Bob', kind: 'order', turnNumber: 4, phase: 'SOT', message: 'other phase' }),
    message('ccc', { username: 'Bob', kind: 'order', turnNumber: 4, phase: 'TRADE', message: 'second draft' }),
    message('dddd', { username: 'Alice', kind: 'order', turnNumber: 4, phase: 'TRADE', message: 'alice trade' }),
  ]

  it('marks an order replaced only by a newer one from the same player, turn and phase', async () => {
    chatPage.mockResolvedValue(page(twice))
    const { container } = await renderPanel(makeView())

    const tagOf = (text: string): string | null | undefined =>
      Array.from(container.querySelectorAll('.chat-orders-message'))
        .find((row) => row.textContent?.includes(text))
        ?.querySelector('.tag:not(.turn)')?.textContent
    expect(tagOf('first draft')).toBe('replaced')
    expect(tagOf('second draft')).toBeUndefined()
    expect(tagOf('other phase')).toBeUndefined()
    expect(tagOf('alice trade')).toBeUndefined()
  })

  it('treats migrated orders like any others: older versions replaced, the tag reads T2 · CM', async () => {
    chatPage.mockResolvedValue(page([
      message('legacy-g-2-Bob-CM-0', { username: 'Bob', kind: 'order', turnNumber: 2, phase: 'CM', message: 'migrated first' }),
      message('legacy-g-2-Bob-CM-1', { username: 'Bob', kind: 'order', turnNumber: 2, phase: 'CM', message: 'migrated second' }),
    ]))
    const { container } = await renderPanel(makeView())

    const [older, newer] = Array.from(container.querySelectorAll('.chat-orders-message'))
    expect(older?.querySelector('.tag:not(.turn)')?.textContent).toBe('replaced')
    expect(newer?.querySelector('.tag:not(.turn)')).toBeNull()
    expect(older?.querySelector('.tag.turn')?.textContent).toBe('T2 · CM')
    expect(newer?.querySelector('.tag.turn')?.textContent).toBe('T2 · CM')
  })

  it('does not count a turn or a chat message as a replacement', () => {
    const ids = replacedOrderIds([
      message('a', { kind: 'order', turnNumber: 3, phase: 'TRADE' }),
      message('bb', { kind: 'order', turnNumber: 4, phase: 'TRADE' }),
      message('ccc', { kind: 'chat' }),
    ])
    expect(ids.size).toBe(0)
  })
})

describe('the composer', () => {
  it('explains that accepting records agreement but does not transfer resources', async () => {
    await renderPanel(makeView())
    expect(screen.getByText(/Accepting records that you agreed to the terms/i).textContent)
      .toContain('It does not transfer resources')
    expect(screen.getByText(/Accepting records that you agreed to the terms/i).textContent)
      .toContain('legal trade window')
  })

  it('sends chat through the chat route and clears the field', async () => {
    await renderPanel(makeView())

    await type('Chat message', '  hello there  ')
    await click(screen.getByRole('button', { name: 'Send' }))

    expect(sendChat).toHaveBeenCalledExactlyOnceWith('game', 'hello there')
    expect(postOrder).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Chat message') as HTMLTextAreaElement).value).toBe('')
  })

  it('does not send an empty message', async () => {
    await renderPanel(makeView())
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('defaults an order to the current turn and the first phase not done', async () => {
    await renderPanel(makeView())

    await click(screen.getByRole('button', { name: 'Order' }))

    expect((screen.getByLabelText('Turn') as HTMLSelectElement).value).toBe('4')
    // Start of turn and Trade are done in turn 4, so City management is next
    expect((screen.getByLabelText('Phase') as HTMLSelectElement).value).toBe('CM')
    await type('Order', 'Move the army')
    await click(screen.getByRole('button', { name: 'Send' }))
    expect(postOrder).toHaveBeenCalledExactlyOnceWith('game', 'CM', 'Move the army', 4)
    expect(sendChat).not.toHaveBeenCalled()
  })

  it('offers only the turns that have started, however far back one is picked', async () => {
    await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Order' }))
    const turns = (): string[] =>
      Array.from((screen.getByLabelText('Turn') as HTMLSelectElement).options).map((option) => option.textContent ?? '')

    // The fixture is in turn 4, so there is no turn 5 yet
    expect(turns()).toEqual(['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'])
    await act(async () => { fireEvent.change(screen.getByLabelText('Turn'), { target: { value: '2' } }) })
    expect(turns()).toEqual(['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'])
    await act(async () => { fireEvent.change(screen.getByLabelText('Turn'), { target: { value: '4' } }) })
    expect(turns()).toEqual(['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'])
  })

  it('moves the viewer on to the next turn once Research is done, without waiting for the others', async () => {
    const finished = makeView({
      you: seat('Alice', 1, {
        playerTurns: [
          { turnNumber: 3, done: doneUpTo('RESEARCH') },
          { turnNumber: 4, done: doneUpTo('RESEARCH') },
        ],
      }),
    })
    // The game is still on turn 4: Bob has not finished it
    expect(finished.activeTurn?.turnNumber).toBe(4)
    expect(viewerTurn(finished)).toBe(5)

    await renderPanel(finished)
    await click(screen.getByRole('button', { name: 'Order' }))

    expect((screen.getByLabelText('Turn') as HTMLSelectElement).value).toBe('5')
    expect((screen.getByLabelText('Phase') as HTMLSelectElement).value).toBe('SOT')
    const turns = Array.from((screen.getByLabelText('Turn') as HTMLSelectElement).options).map((option) => option.textContent)
    expect(turns).toEqual(['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4', 'Turn 5'])
  })

  it('does not move the viewer on while a phase of the turn is still open', () => {
    expect(viewerTurn(makeView())).toBe(4)
    const researchOpen = makeView({
      you: seat('Alice', 1, { playerTurns: [{ turnNumber: 4, done: doneUpTo('MOVEMENT') }] }),
    })
    expect(viewerTurn(researchOpen)).toBe(4)
    // A spectator, or a player with no records, stays on the game's turn
    expect(viewerTurn(makeView({ you: null }))).toBe(4)
  })

  it('gives the composer the simple formatting bar, and the private log the default one', async () => {
    await renderPanel(makeView())

    expect(screen.getByLabelText('Chat message').getAttribute('data-toolbar')).toBe('simple')
    await click(screen.getByRole('button', { name: 'Order' }))
    expect(screen.getByLabelText('Order').getAttribute('data-toolbar')).toBe('simple')

    // The private log asks for nothing, so the editor's own default (the full bar) applies
    await click(filterChip('Private'))
    expect(screen.getByLabelText('Private log').hasAttribute('data-toolbar')).toBe(false)
  })

  it('never offers a turn the viewer has skipped over, or one before the game\'s own', () => {
    // Turn 4 is the game's. The viewer finished 4, and also 6 (writing ahead)
    const ahead = makeView({
      you: seat('Alice', 1, {
        playerTurns: [
          { turnNumber: 3, done: doneUpTo('RESEARCH') },
          { turnNumber: 4, done: doneUpTo('RESEARCH') },
          { turnNumber: 6, done: doneUpTo('RESEARCH') },
        ],
      }),
    })
    expect(viewerTurn(ahead)).toBe(5)
  })

  it('lets the turn and the phase be changed before sending', async () => {
    await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Order' }))

    await act(async () => { fireEvent.change(screen.getByLabelText('Turn'), { target: { value: '3' } }) })
    await act(async () => { fireEvent.change(screen.getByLabelText('Phase'), { target: { value: 'RESEARCH' } }) })
    await type('Order', 'Go back')
    await click(screen.getByRole('button', { name: 'Send' }))

    expect(postOrder).toHaveBeenCalledExactlyOnceWith('game', 'RESEARCH', 'Go back', 3)
  })

  it('follows the viewer to the next phase once one is marked done, unless they picked one', async () => {
    const { rerender } = await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Order' }))
    expect((screen.getByLabelText('Phase') as HTMLSelectElement).value).toBe('CM')

    const further = makeView({
      you: seat('Alice', 1, { playerTurns: [{ turnNumber: 4, done: doneUpTo('CM') }] }),
    })
    await act(async () => {
      rerender(
        <ChatOrdersPanel
          gameId="game" view={further} busy={false} readOnly={false} run={run}
          reloadCount={0} autoRefresh={false} editorComponent={FakeEditor}
        />,
      )
    })

    expect((screen.getByLabelText('Phase') as HTMLSelectElement).value).toBe('MOVEMENT')
  })

  it('falls back to Research when every phase is done', () => {
    const view = makeView({
      you: seat('Alice', 1, { playerTurns: [{ turnNumber: 4, done: doneUpTo('RESEARCH') }] }),
    })
    expect(firstOpenPhase(view, 4)).toBe('RESEARCH')
    // No record for the turn yet: everything is open
    expect(firstOpenPhase(view, 9)).toBe('SOT')
  })

  it('is absent for a spectator and while the game is read-only', async () => {
    chatPage.mockResolvedValue(page([message('a')]))
    const spectator = await renderPanel(makeView({ you: null }))
    expect(spectator.container.querySelector('.chat-orders-composer')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Private' })).toBeNull()
    cleanup()

    const replay = await renderPanel(makeView(), { readOnly: true })
    expect(replay.container.querySelector('.chat-orders-composer')).toBeNull()
    expect(screen.getByRole('log', { name: 'Timeline' })).not.toBeNull()
  })
})

describe('Load more', () => {
  it('fetches the turn before the oldest loaded message and puts it above', async () => {
    chatPage
      .mockResolvedValueOnce(page([message('cc'), message('ddd')], true))
      .mockResolvedValueOnce(page([message('a'), message('bb')], false))
    const { container } = await renderPanel(makeView())

    await click(screen.getByRole('button', { name: 'Load more' }))

    expect(chatPage).toHaveBeenLastCalledWith('game', 'cc')
    expect(rows(container)).toEqual(['text of a', 'text of bb', 'text of cc', 'text of ddd'])
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('is not offered when the server says there is nothing older', async () => {
    chatPage.mockResolvedValue(page([message('a')], false))
    await renderPanel(makeView())
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('keeps the button and shows the error when the request fails', async () => {
    chatPage
      .mockResolvedValueOnce(page([message('a')], true))
      .mockRejectedValueOnce(new Error('boom'))
    await renderPanel(makeView())

    await click(screen.getByRole('button', { name: 'Load more' }))

    expect(screen.getByText('boom')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Load more' })).not.toBeNull()
  })
})

describe('a game change and unmounting', () => {
  const panelFor = (gameId: string): React.JSX.Element => (
    <ChatOrdersPanel
      gameId={gameId} view={makeView()} busy={false} readOnly={false} run={run}
      reloadCount={0} autoRefresh={false} editorComponent={FakeEditor}
    />
  )

  it('starts the next game empty and drops a Load more that was still in flight', async () => {
    let finishOlder: ((older: ChatPageDto) => void) | undefined
    chatPage
      .mockResolvedValueOnce(page([message('cc')], true))
      .mockImplementationOnce(() => new Promise((resolve) => { finishOlder = resolve }))
      .mockResolvedValueOnce(page([message('zzz', { message: 'other game' })], false))
    const { container, rerender } = await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Load more' }))

    await act(async () => { rerender(panelFor('other')) })
    expect(rows(container)).toEqual(['other game'])
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()

    await act(async () => { finishOlder?.(page([message('old', { message: 'from the first game' })], true)) })

    expect(rows(container)).toEqual(['other game'])
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  // This cannot prove the guard: React 18 and later no longer warns about a state
  // update on an unmounted component, so the spy would stay quiet either way. It
  // does show that a late page after unmount does not throw.
  it('does not throw when a page arrives after the panel is gone', async () => {
    let finish: ((first: ChatPageDto) => void) | undefined
    chatPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { unmount } = await renderPanel(makeView())
    unmount()

    await act(async () => { finish?.(page([message('a')])) })

    expect(errors).not.toHaveBeenCalled()
  })
})

describe('the filter tabs by keyboard', () => {
  const press = async (element: HTMLElement, key: string): Promise<void> => {
    await act(async () => { fireEvent.keyDown(element, { key }) })
  }
  const selected = (): string | undefined =>
    within(screen.getByRole('tablist', { name: 'Show' }))
      .getAllByRole('tab')
      .find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? undefined

  it('has one tab stop, on the selected tab, and each tab names the panel it controls', async () => {
    await renderPanel(makeView())

    const tabs = within(screen.getByRole('tablist', { name: 'Show' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])
    const panel = screen.getByRole('tabpanel')
    expect(filterChip('All').getAttribute('aria-controls')).toBe(panel.id)
    expect(filterChip('Chat').getAttribute('aria-controls')).toBe(panel.id)
    // The Private tab controls the other panel, which exists once it is selected
    await click(filterChip('Private'))
    expect(filterChip('Private').getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id)
    expect(within(screen.getByRole('tablist', { name: 'Show' })).getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([-1, -1, -1, 0])
  })

  it('moves with the arrow keys, wrapping at both ends, and with Home and End', async () => {
    await renderPanel(makeView())

    await press(filterChip('All'), 'ArrowRight')
    expect(selected()).toBe('Orders')
    await press(filterChip('Orders'), 'End')
    expect(selected()).toBe('Private')
    await press(filterChip('Private'), 'ArrowRight')
    expect(selected()).toBe('All')
    await press(filterChip('All'), 'ArrowLeft')
    expect(selected()).toBe('Private')
    await press(filterChip('Private'), 'Home')
    expect(selected()).toBe('All')
    // Any other key does nothing
    await press(filterChip('All'), 'a')
    expect(selected()).toBe('All')
  })
})

describe('the selected chip', () => {
  it('has a style of its own, which the stylesheet gives to aria-selected as well as aria-pressed', () => {
    const css = readFileSync('src/views/ChatOrdersPanel.css', 'utf8')
    expect(css).toContain(".chat-orders-chip[aria-selected='true']")
    expect(css).toContain(".chat-orders-chip[aria-pressed='true']")
  })

  it('does not rely on a class that no rule styles', async () => {
    await renderPanel(makeView())
    expect(filterChip('All').className).toBe('chat-orders-chip')
    expect(screen.getByRole('button', { name: 'Chat' }).className).toBe('chat-orders-chip')
  })
})

describe('the Markdown renderer', () => {
  it('is loaded on demand, not imported by the panel, so the page does not carry it up front', () => {
    const source = readFileSync('src/views/ChatOrdersPanel.tsx', 'utf8')
    expect(source).not.toMatch(/^import .* from '\.\/SafeMarkdown\.js'/m)
    expect(source).toContain("import('./SafeMarkdown.js')")
  })
})

describe('tabs and replay', () => {
  it('labels the panel by the tab that is selected', async () => {
    chatPage.mockResolvedValue(page([message('a')]))
    await renderPanel(makeView())

    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(filterChip('All').id)
    await click(filterChip('Orders'))
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(filterChip('Orders').id)
    await click(filterChip('Private'))
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(filterChip('Private').id)
  })

  it('says the private log is not part of the history while a revision is on screen', async () => {
    await act(async () => {
      render(
        <ChatOrdersPanel
          gameId="game" view={makeView()} busy={false} readOnly replaying run={run}
          reloadCount={0} autoRefresh={false} editorComponent={FakeEditor}
        />,
      )
    })

    await click(filterChip('Private'))

    expect(screen.getByText('Your private log is not part of the history.')).not.toBeNull()
    expect(screen.queryByLabelText('Private log')).toBeNull()
    expect(document.body.textContent).not.toContain('my private plan')
  })
})

describe('the Done button', () => {
  const optionTexts = (): string[] =>
    Array.from((screen.getByLabelText('Phase') as HTMLSelectElement).options).map((option) => option.textContent ?? '')

  it('is only there for an order, where the turn and the phase are chosen', async () => {
    await renderPanel(makeView())

    expect(screen.queryByRole('button', { name: /as done$/ })).toBeNull()
    await click(screen.getByRole('button', { name: 'Order' }))
    const button = screen.getByRole('button', { name: 'End turn: mark City management as done' })
    expect(button.textContent).toBe('End turn')
    // The accessible name starts with the visible label (WCAG 2.5.3)
    expect(button.getAttribute('aria-label')?.startsWith(button.textContent ?? '')).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marks the default turn and phase done', async () => {
    await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Order' }))

    await click(screen.getByRole('button', { name: 'End turn: mark City management as done' }))

    expect(markDone).toHaveBeenCalledExactlyOnceWith('game', 'CM', 4)
    expect(unmarkDone).not.toHaveBeenCalled()
  })

  it('marks the phase and the turn that were picked, not the defaults', async () => {
    await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Order' }))

    await act(async () => { fireEvent.change(screen.getByLabelText('Phase'), { target: { value: 'MOVEMENT' } }) })
    await click(screen.getByRole('button', { name: 'End turn: mark Movement as done' }))

    expect(markDone).toHaveBeenCalledExactlyOnceWith('game', 'MOVEMENT', 4)
  })

  it('strikes through the phases that are done, in the turn that is chosen', async () => {
    await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Order' }))

    // Start of turn and Trade are done in turn 4
    expect(optionTexts()).toEqual([strikeThrough('Start of turn'), strikeThrough('Trade'), 'City management', 'Movement', 'Research'])
    await act(async () => { fireEvent.change(screen.getByLabelText('Turn'), { target: { value: '3' } }) })
    // Turn 3 was finished
    expect(optionTexts().every((text) => text.includes('\u0336'))).toBe(true)
    await act(async () => { fireEvent.change(screen.getByLabelText('Turn'), { target: { value: '4' } }) })
    expect(optionTexts().filter((text) => text.includes('\u0336'))).toHaveLength(2)
  })

  it('on a phase that is done, offers to undo it, and an order can still be written there', async () => {
    await renderPanel(makeView())
    await click(screen.getByRole('button', { name: 'Order' }))
    await act(async () => { fireEvent.change(screen.getByLabelText('Phase'), { target: { value: 'TRADE' } }) })

    expect(screen.queryByRole('button', { name: /^End turn/ })).toBeNull()
    await type('Order', 'Trade again')
    await click(screen.getByRole('button', { name: 'Send' }))
    expect(postOrder).toHaveBeenCalledExactlyOnceWith('game', 'TRADE', 'Trade again', 4)

    const undo = screen.getByRole('button', { name: 'Not done: unmark Trade as done' })
    expect(undo.textContent).toBe('Not done')
    await click(undo)
    expect(unmarkDone).toHaveBeenCalledExactlyOnceWith('game', 'TRADE', 4)
    expect(markDone).not.toHaveBeenCalled()
  })

  it('is not there when the viewer cannot write', async () => {
    await renderPanel(makeView(), { readOnly: true })

    expect(screen.queryByRole('button', { name: 'Order' })).toBeNull()
    expect(screen.queryByRole('button', { name: /as done$/ })).toBeNull()
  })
})

describe('the Private tab', () => {
  it('shows the viewer\'s own private log and saves it, and nothing of anyone else\'s', async () => {
    // A double of a leak: an opponent record that carries a note, which the
    // panel must never read.
    const view = makeView({
      opponents: [seat('Bob', 2, { gamenote: 'BOB-SECRET-PLAN', privateLog: 'BOB-PRIVATE-LOG' })],
    })
    const { container } = await renderPanel(view)

    await click(filterChip('Private'))

    expect((screen.getByLabelText('Private log') as HTMLTextAreaElement).value).toBe('my private plan')
    expect(container.textContent).not.toContain('BOB-SECRET-PLAN')
    expect(container.textContent).not.toContain('BOB-PRIVATE-LOG')
    // The composer belongs to the timeline
    expect(container.querySelector('.chat-orders-composer')).toBeNull()

    expect((screen.getByRole('button', { name: 'Save private log' }) as HTMLButtonElement).disabled).toBe(true)
    await type('Private log', 'a new plan')
    await click(screen.getByRole('button', { name: 'Save private log' }))
    expect(saveNote).toHaveBeenCalledExactlyOnceWith('game', 'a new plan')
  })

  it('never puts the note in the timeline, whatever the tab', async () => {
    chatPage.mockResolvedValue(page([message('a')]))
    const { container } = await renderPanel(makeView())
    expect(container.textContent).not.toContain('my private plan')
    await click(filterChip('Orders'))
    expect(container.textContent).not.toContain('my private plan')
  })

  it('asks before leaving with an unsaved private log', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderPanel(makeView())
    await click(filterChip('Private'))
    await type('Private log', 'unsaved words')

    const detail = { allowed: true }
    window.dispatchEvent(new CustomEvent('civ:navigation-attempt', { detail }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(detail.allowed).toBe(false)
  })
})

describe('safe markdown in the timeline', () => {
  it('renders formatting but keeps script, onerror and javascript: links inert', async () => {
    chatPage.mockResolvedValue(page([
      message('a', { message: '**strong** <script>window.hacked = 1</script>' }),
      message('bb', { message: '<img src=x onerror="window.hacked = 2">' }),
      message('ccc', { message: '[click](javascript:alert(1)) and [fine](https://example.com)' }),
    ]))
    const { container } = await renderPanel(makeView())

    expect(container.querySelector('strong.player-blue')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('.chat-orders-body strong')).map((node) => node.textContent))
      .toContain('strong')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
    const links = Array.from(container.querySelectorAll('.chat-orders-body a'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://example.com'])
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(links[0]?.getAttribute('target')).toBe('_blank')
  })
})

describe('header helpers', () => {
  it('names whose turn it is and which phase they are on, not everyone', () => {
    const view = makeView()
    expect(turnTitle(view.activeTurn)).toBe(
      `Turn 4 · ${view.activeTurn?.username}'s turn — ${TURN_PHASE_LABEL[view.activeTurn?.phase ?? 'SOT']} phase`,
    )
    expect(turnTitle(view.activeTurn)).not.toContain('waiting for')
    expect(turnTitle(view.activeTurn)).not.toContain('started')
  })

  it('says Your turn when the viewer is the one up', () => {
    const view = makeView({
      activeTurn: { playerId: 'p1', username: 'Alice', turnNumber: 2, phase: 'CM', startPlayer: 'Bob', waitingFor: [{ username: 'Alice', phase: 'CM' }] },
    })
    expect(turnTitle(view.activeTurn, 'p1')).toBe('Turn 2 · Your turn — city management phase')
    expect(turnTitle(view.activeTurn, 'someone-else')).toBe("Turn 2 · Alice's turn — city management phase")
  })

  it('says so when everyone is done, and when nobody is up', () => {
    const finished = { playerId: 'p', username: 'Alice', turnNumber: 5, phase: 'SOT', startPlayer: 'Cy', waitingFor: [] }
    expect(turnTitle(makeView({ activeTurn: finished }).activeTurn)).toBe('Turn 5 · everyone is done')
    expect(turnTitle(null)).toBe('Nobody is up')
  })

  it('lists every player with a colour dot and their phase, or Done', () => {
    const view = makeView({
      you: seat('Alice', 1, { color: 'Red' }),
      opponents: [seat('Bob', 2, { color: 'Blue' }), seat('Cy', 3, { color: 'Green' })],
      activeTurn: {
        playerId: 'id-Alice', username: 'Alice', turnNumber: 4, phase: 'CM',
        waitingFor: [{ username: 'Alice', phase: 'CM' }, { username: 'Bob', phase: 'TRADE' }],
      },
    })
    const { container } = render(<TurnStatusStrip view={view} />)

    expect(Array.from(container.querySelectorAll('li')).map((item) => item.textContent)).toEqual([
      'AliceCM',
      'BobTrade',
      'CyDone',
    ])
    expect(Array.from(container.querySelectorAll('.chat-orders-dot')).map((dot) => dot.className)).toEqual([
      'chat-orders-dot player-red',
      'chat-orders-dot player-blue',
      'chat-orders-dot player-green',
    ])
  })

  it('asks before an out-of-turn draw only when someone else is up', () => {
    const others = { playerId: 'id-Bob', username: 'Bob', turnNumber: 4, phase: 'SOT', waitingFor: [] }
    expect(outOfTurnQuestion(makeView({ activeTurn: others }))).toBe(
      'It is not your turn. Bob is up. Draw anyway?',
    )
    expect(outOfTurnQuestion(makeView())).toBeNull()
    expect(outOfTurnQuestion(makeView({ activeTurn: null }))).toBe(
      'It is not your turn. Nobody is up. Draw anyway?',
    )
    expect(outOfTurnQuestion(makeView({ you: null, activeTurn: others }))).toBeNull()
  })
})
