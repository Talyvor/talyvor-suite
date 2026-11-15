import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../App'
import { pressEverything } from '../test/pressEverything'

// B61.38 — Help is a chat in the top bar of every signed-in page and on Settings, Help: a question the help pages
// answer gets its answer and its page, one they do not gets "I don't know that" and "Send to our team", which files
// the chat so far and opens the person's own email to Talyvor with the question; the day's limit is said in words.

const at = '2026-11-15T09:00:00Z'
type Msg = { by: string; text: string; page?: string; team?: boolean; topic?: string; at: string }

function mockBff(answer: (q: string) => { status?: number; reply?: Msg; error?: string }) {
  const sent: Array<{ path: string; method: string; body: unknown }> = []
  let chat: Msg[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url.startsWith('/api/help/')) sent.push({ path: url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/help/chat' && method === 'GET') return json({ messages: chat, kept_days: 30 })
    if (url === '/api/help/chat' && method === 'DELETE') {
      chat = []
      return new Response(null, { status: 204 })
    }
    if (url === '/api/help/ask') {
      const { question } = JSON.parse(String(init?.body)) as { question: string }
      const a = answer(question)
      chat = [...chat, { by: 'you', text: question, at }, ...(a.reply ? [a.reply] : [])]
      return json(a.error ? { error: a.error, messages: chat } : { messages: chat }, a.status ?? 200)
    }
    if (url === '/api/help/team') return json({ id: 9, kind: 'support', state: 'received' }, 201)
    return new Response('null', { status: 404 })
  })
  return { sent, setChat: (c: Msg[]) => (chat = c) }
}

function open(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
}

async function ask(q: string) {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Help' }))[0])
  const panel = within(await screen.findByTestId('help-chat'))
  fireEvent.change(panel.getByLabelText('Your question'), { target: { value: q } })
  fireEvent.click(panel.getByRole('button', { name: 'Ask' }))
  return panel
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Help chat (B61.38)', () => {
  it('answers from the help pages with the page to open, and says who wrote each line', async () => {
    const { sent } = mockBff(() => ({ reply: { by: 'ai', text: 'Open Agents and press Create agent.', page: '/agents', at } }))
    open('/approvals')
    const panel = await ask('How do I make an agent?')

    expect(await panel.findByText('Open Agents and press Create agent.')).toBeTruthy()
    expect(panel.getByText('Ask us anything about Talyvor.')).toBeTruthy()
    expect(panel.getByText('Answers are written by AI.')).toBeTruthy()
    expect(within(panel.getByTestId('help-you')).getByText('You')).toBeTruthy()
    expect(within(panel.getByTestId('help-ai')).getByText('Talyvor AI')).toBeTruthy()
    expect(panel.getByRole('link', { name: 'Open Agents' }).getAttribute('href')).toBe('/agents')
    expect(panel.queryByRole('button', { name: 'Send to our team' })).toBeNull()
    expect(sent.find((s) => s.path === '/api/help/ask')?.body).toEqual({ question: 'How do I make an agent?', page: '/approvals' })
  })

  it('does not know, and Send to our team files the chat and opens the email with the question', async () => {
    const { sent } = mockBff(() => ({
      reply: { by: 'ai', text: "I don't know that. Our team can help: send it to them and we answer by email.", team: true, at },
    }))
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    open('/')
    const panel = await ask('When does my statement close?')

    expect(await panel.findByText(/^I don't know that\./)).toBeTruthy()
    expect(panel.getByText('We answer by email.')).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'Send to our team' }))

    await waitFor(() => expect(opened).toHaveBeenCalled())
    expect(sent.filter((s) => s.path === '/api/help/team' && s.method === 'POST')).toHaveLength(1)
    expect(opened.mock.calls[0][0]).toBe(
      `mailto:hello@talyvor.com?subject=Help%20with%20Talyvor&body=${encodeURIComponent('When does my statement close?')}`,
    )
    expect(panel.getByRole('status').textContent).toContain('Sent to our team. We answer by email.')
  })

  it('a complaint goes to the complaints form', async () => {
    mockBff(() => ({ reply: { by: 'ai', text: 'A complaint goes to our complaints form.', team: true, topic: 'complaint', page: '/settings/help', at } }))
    open('/')
    const panel = await ask('I want to complain')
    fireEvent.click(await panel.findByRole('link', { name: 'Make a complaint' }))
    expect(await screen.findByLabelText('What is it?')).toHaveProperty('value', 'complaint')
  })

  it('says the day’s limit in words, and offers the team', async () => {
    mockBff(() => ({ status: 429, error: 'You have asked 20 questions today, the most for one day. Ask again tomorrow, or send this to our team.' }))
    open('/')
    const panel = await ask('One more?')
    expect((await panel.findByRole('alert')).textContent).toBe(
      'You have asked 20 questions today, the most for one day. Ask again tomorrow, or send this to our team.',
    )
    expect(panel.getByRole('button', { name: 'Send to our team' })).toBeTruthy()
    expect(panel.getByText('One more?')).toBeTruthy()
  })

  it('opens from Settings, Help', async () => {
    mockBff(() => ({}))
    open('/settings/help')
    fireEvent.click(await screen.findByRole('link', { name: 'Open Help' }))
    expect(await screen.findByTestId('help-chat')).toBeTruthy()
  })

  it('Your data lists the chat, and deletes it', async () => {
    const { sent, setChat } = mockBff(() => ({}))
    setChat([{ by: 'you', text: 'Where is my card?', at }])
    open('/settings/data')
    const kept = within(await screen.findByTestId('help-chat-kept'))
    expect(await kept.findByText('Where is my card?')).toBeTruthy()
    fireEvent.click(kept.getByRole('button', { name: 'Delete this chat' }))
    expect(await kept.findByText('No Help chat kept.')).toBeTruthy()
    expect(sent.some((s) => s.path === '/api/help/chat' && s.method === 'DELETE')).toBe(true)
  })

  it('every control in the open panel does something', async () => {
    const report = await pressEverything('/?help=open')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThanOrEqual(3)
  })
})
