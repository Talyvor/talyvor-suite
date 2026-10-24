import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../App'
import { populatedBff } from '../populatedBff'

// B45.6 — Taly's button on every signed-in page. The model is stubbed: it answers with what Taly told it the page
// shows, so an answer naming the agent or the room proves Taly knew which one was on screen.

const ROOM = {
  id: 'room_pricing', owner_workspace_id: 'ws_populated', title: 'Agent pricing research', topic: 'research', description: '',
  visibility: 'public', status: 'open', terms_version: 1, member_count: 1, created_at: '', last_activity_at: '2026-10-06T16:00:00Z',
  terms: { version: 1, split_rule: 'equal', remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'owner_only', created_at: '' },
  members: null, agents: null, me: null,
}

function sse(provider: string, text: string): Response {
  const frames =
    provider === 'openai'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`
  return new Response(frames, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const asked: unknown[] = []
  const spy = vi.spyOn(globalThis, 'fetch')
  populatedBff((fixture) => {
    spy.mockImplementation(async (input, init) => {
      const url = String(input)
      const stream = /^\/api\/ai\/stream\/([^/]+)\//.exec(url)
      if (stream !== null) {
        const body = JSON.parse(String(init?.body)) as { system?: string; messages: { role: string; content: string }[] }
        asked.push(body)
        const told = body.system ?? body.messages.find((m) => m.role === 'system')?.content ?? ''
        return sse(stream[1], `You are looking at: ${told}`)
      }
      if (url === '/api/rooms/room_pricing') return new Response(JSON.stringify(ROOM), { status: 200 })
      return fixture(input)
    })
  })
  return asked
}

async function ask(question: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Taly' }))
  const panel = await screen.findByRole('dialog', { name: /^Taly, on / })
  const input = within(panel).getByRole('textbox', { name: 'Ask Taly about this page' })
  fireEvent.change(input, { target: { value: question } })
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Send' })).not.toBeDisabled())
  fireEvent.keyDown(input, { key: 'Enter' })
  return within(panel).findByTestId('taly-answer', {}, { timeout: 3000 }).then(async (a) => {
    await waitFor(() => expect(a.textContent).not.toBe(''))
    return a
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

describe('Taly’s button', () => {
  it.each([
    ['Home', '/', /"Home" page/],
    ['an agent page', '/agents?agent=agt_research', /Researcher/],
    ['a room page', '/rooms/room_pricing', /Agent pricing research/],
  ])('answers "what is this?" about what %s shows', async (_, address, object) => {
    const asked = mockBff()
    window.history.pushState({}, '', address)
    render(<App />)
    await screen.findByRole('navigation')
    // Wait for the page's own data, so Taly is told the screen rather than its spinner.
    if (address !== '/') await screen.findAllByText(object, { selector: 'main *' })
    const answer = await ask('what is this?')
    await waitFor(() => expect(answer.textContent).toMatch(object))
    expect(asked).toHaveLength(1)
  })

  it('is labelled, opens from the keyboard, closes on Esc and is not on Chat or public pages', async () => {
    mockBff()
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Ask Taly' })
    button.focus()
    fireEvent.click(button)
    const input = await screen.findByRole('textbox', { name: 'Ask Taly about this page' })
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Taly/ })).toBeNull())
    expect(screen.getByRole('button', { name: 'Ask Taly' })).toHaveFocus()

    act(() => window.history.pushState({}, '', '/chat'))
    cleanup()
    render(<App />)
    await screen.findByRole('navigation')
    expect(screen.queryByRole('button', { name: 'Ask Taly' })).toBeNull()

    cleanup()
    window.history.pushState({}, '', '/pricing')
    render(<App />)
    await screen.findAllByRole('heading')
    expect(screen.queryByRole('button', { name: 'Ask Taly' })).toBeNull()
  })
})
