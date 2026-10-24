import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { forgetSpeechAvailable } from './voice'
import { MIC_REFUSED, NOT_HEARD } from './VoiceButton'

// B40.12 — talking to Talyvor in Chat, driven at the wire: the microphone's recording goes to the BFF's transcription
// route, the words land in the box and, once sent, go through Chat's normal pipeline, and the answer is shown and read aloud through the speech route.
// "Pay the ACME invoice" said aloud is prepared as a voice request, read back with the payee and the amount — never the
// account number — and paid only once a passkey signs the approval.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const ANSWER = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Your agents spent **4.20 LXC** this week.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
  { type: 'message_stop' },
)
const ACME = { id: 'payee_acme', name: 'ACME Ltd', country: 'GB', sort_code: '040004', account_number: '12345678', check: 'exact_match' }
const ITEM = { position: 1, payee_id: 'payee_acme', payee_name: 'ACME Ltd', currency: 'GBP', amount_minor: 12000, reference: 'ACME invoice' }
const REQUEST = {
  id: 'preq_1', status: 'pending_approval', summary: 'Pay ACME Ltd', client: 'voice', totals: { GBP: 12000 }, created_at: '2026-10-24T09:00:00Z',
  items: [{ ...ITEM, decision: 'needs_approval', reason: 'a request from voice always needs approval' }],
}

/** What the person "says": each recording the fake microphone hands over is transcribed as the next of these. */
let heard: string[] = []
/** B47.1 — how the transcription route answers: the once-per-page probe (no body), and a recording. */
let probeStatus = 400
let transcribeStatus = 200

class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  stream: { getTracks: () => { stop: () => void }[] }
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(stream: FakeRecorder['stream']) {
    this.stream = stream
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['recorded'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

function mockBff() {
  const spoken: string[] = []
  const transcribed: (FormDataEntryValue | null)[] = []
  const prepared: { body: unknown; key: string | null }[] = []
  const approvals: unknown[] = []
  const approved: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models')
      return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, release_date: '2026-07-24', tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/ai/stream/anthropic/v1/messages') return new Response(ANSWER, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    if (url === '/api/chat/voice/transcriptions') {
      if (init?.body === undefined) return json({ error: 'probe' }, probeStatus)
      transcribed.push((init.body as FormData).get('file'))
      if (transcribeStatus !== 200) return json({ error: 'speech is not configured on this Lens' }, transcribeStatus)
      return json({ text: heard.shift() ?? '' })
    }
    if (url === '/api/chat/voice/speech') {
      spoken.push((JSON.parse(String(init?.body)) as { input: string }).input)
      return new Response(new Blob(['ID3'], { type: 'audio/mpeg' }), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
    }
    if (url === '/api/money/payees') return json({ payees: [ACME] })
    if (url === '/api/money/payments') return json({ payments: [] })
    if (url === '/api/money/payment-requests' && init?.method === 'POST') {
      prepared.push({ body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('Idempotency-Key') })
      return json(REQUEST, 201)
    }
    if (url === '/api/money/payment-requests/preq_1/approval') {
      approvals.push(JSON.parse(String(init?.body)))
      return json({ statement: JSON.stringify({ request_id: 'preq_1', items: [ITEM], totals: { GBP: 12000 } }), challenge: 'AAAA', allow_credentials: ['AAAA'] })
    }
    if (url === '/api/money/payment-requests/preq_1/approve') {
      approved.push(JSON.parse(String(init?.body)))
      return json({ ...REQUEST, status: 'approved', items: [{ ...REQUEST.items[0], pay_status: 'paid' }] })
    }
    return new Response('null', { status: 404 })
  })
  const asked = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u) === '/api/ai/stream/anthropic/v1/messages').length
  return { spoken, transcribed, prepared, approvals, approved, asked }
}

const played = vi.fn()

beforeEach(() => {
  heard = []
  probeStatus = 400
  transcribeStatus = 200
  forgetSpeechAvailable()
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] })) },
  })
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      get: vi.fn(async () => ({
        rawId: new Uint8Array([1]).buffer,
        response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer },
      })),
    },
  })
  URL.createObjectURL = vi.fn(() => 'blob:spoken')
  URL.revokeObjectURL = vi.fn()
  played.mockReset()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => played())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

/** Tap the microphone, "talk", tap it again: the recording goes off to be heard. */
async function dictate(words: string) {
  heard.push(words)
  fireEvent.click(await screen.findByRole('button', { name: 'Talk' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
}

/** Dictate, then press Send: what was said lands in the box and goes only when sent. */
async function say(words: string) {
  await dictate(words)
  await waitFor(() => expect(screen.getByLabelText('Your message')).toHaveValue(words))
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

async function openChat() {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
}

describe('talking to Talyvor in Chat (B40.12)', () => {
  it('answers a spoken question in text and aloud, saying first that this is an AI', async () => {
    const bff = mockBff()
    await openChat()
    await say('What did my agents spend this week?')

    expect(screen.getByTestId('voice-note')).toHaveTextContent('You’re talking to an AI.')
    await waitFor(() => expect(screen.getAllByTestId('turn-assistant').at(-1)).toHaveTextContent('Your agents spent 4.20 LXC this week.'), { timeout: 5_000 })
    expect(screen.getAllByTestId('turn-user').at(-1)).toHaveTextContent('What did my agents spend this week?')
    expect(bff.transcribed).toHaveLength(1)
    await waitFor(() => expect(played).toHaveBeenCalledTimes(1))
    // Read without its markdown, and the first time after saying it is an AI.
    expect(bff.spoken).toEqual(['You’re talking to an AI. Your agents spent 4.20 LXC this week.'])
  })

  it('prepares “pay the ACME invoice” as a voice request, reads back the payee and amount, and pays only after a passkey', async () => {
    const bff = mockBff()
    await openChat()
    await say('Pay the ACME invoice.')

    // No amount was said: it asks, aloud, and the next thing said is the amount.
    await screen.findByText('How much should I pay ACME Ltd?')
    await waitFor(() => expect(bff.spoken.at(-1)).toMatch(/How much should I pay ACME Ltd\?$/))
    await say('£120')

    const readback = await screen.findByTestId('chat-pay-readback')
    expect(readback).toHaveTextContent('I’ve prepared a payment of £120.00 to ACME Ltd. Nothing is paid until you approve it with your passkey.')
    expect(bff.prepared).toEqual([
      { body: { voice: true, items: [{ payee_id: 'payee_acme', currency: 'GBP', amount_minor: 12000, reference: 'ACME invoice' }] }, key: expect.any(String) },
    ])
    await waitFor(() => expect(bff.spoken.at(-1)).toBe('I’ve prepared a payment of £120.00 to ACME Ltd. Nothing is paid until you approve it with your passkey.'))
    // The account number is never shown or said; the question was never sent to the model.
    expect(document.body).not.toHaveTextContent('12345678')
    expect(bff.spoken.join(' ')).not.toContain('12345678')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0)

    // Nothing is paid until the passkey signs.
    expect(bff.approved).toHaveLength(0)
    const card = screen.getByTestId('approve-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Approve 1 payment with a passkey' }))
    await within(card).findByText('Approved. Each payment you approved is paid once.')
    expect(bff.approvals).toEqual([{ positions: [1] }])
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1)
    expect(bff.approved).toHaveLength(1)
  })
})

describe('the composer’s microphone (B47.1)', () => {
  it('sits immediately left of Send, records on a tap, and puts what was said in the box without sending it', async () => {
    const bff = mockBff()
    await openChat()
    const mic = await screen.findByRole('button', { name: 'Talk' })
    expect(mic.nextElementSibling).toBe(screen.getByRole('button', { name: 'Send' }))

    heard.push('What did my agents spend?')
    fireEvent.click(mic)
    await screen.findByRole('button', { name: 'Stop recording' })
    expect(screen.getByTestId('voice-recording')).toHaveTextContent('0:00')
    expect(document.body).not.toHaveTextContent(/let go/i)
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))

    await waitFor(() => expect(screen.getByLabelText('Your message')).toHaveValue('What did my agents spend?'))
    expect(bff.transcribed).toHaveLength(1)
    expect(bff.asked()).toBe(0)
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0)
  })

  it('cancels a recording on Esc: nothing is transcribed and the box stays empty', async () => {
    const bff = mockBff()
    await openChat()
    fireEvent.click(await screen.findByRole('button', { name: 'Talk' }))
    await screen.findByRole('button', { name: 'Stop recording' })
    fireEvent.keyDown(window, { key: 'Escape' })

    await screen.findByRole('button', { name: 'Talk' })
    expect(bff.transcribed).toHaveLength(0)
    expect(screen.getByLabelText('Your message')).toHaveValue('')
  })

  it('shows no microphone when the server says speech is not configured', async () => {
    probeStatus = 503
    mockBff()
    await openChat()
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === '/api/chat/voice/transcriptions')).toBe(true))
    expect(screen.queryByTestId('chat-mic')).toBeNull()
  })

  it('takes the microphone away when a recording meets the 503', async () => {
    transcribeStatus = 503
    mockBff()
    await openChat()
    await dictate('hello')
    await waitFor(() => expect(screen.queryByTestId('chat-mic')).toBeNull())
    expect(screen.getByLabelText('Your message')).toHaveValue('')
  })

  it('says one plain line on any other failure and keeps the recording out of the box', async () => {
    transcribeStatus = 500
    mockBff()
    await openChat()
    await dictate('hello')
    await waitFor(() => expect(screen.getByTestId('voice-note')).toHaveTextContent(NOT_HEARD))
    expect(screen.getByLabelText('Your message')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Talk' })).toBeEnabled()
  })

  it('asks for the microphone only on a tap, and says how to allow it when refused', async () => {
    mockBff()
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    await openChat()
    const mic = await screen.findByRole('button', { name: 'Talk' })
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    fireEvent.click(mic)
    await waitFor(() => expect(screen.getByTestId('voice-note')).toHaveTextContent(MIC_REFUSED))
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})
