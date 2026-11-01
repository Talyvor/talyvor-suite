import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseSafeToSpend } from './SafeToSpendQuestion'

// B41.5 — "How much can Researcher spend?" in Chat: the question opens a card that answers from Lens's safe-to-spend
// figure (B41.105), never the model. The BFF is mocked at the wire; that the figure equals Lens's own is proven against
// Lens by the e2e scenario chat-safe-to-spend.

const M = 1_000_000

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier', release_date: '2026-06-01' }])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/safe-to-spend') {
      return json({
        // Every workspace holds a USDC figure too, which Lens keeps to six decimal places (B17.320).
        company: [
          { currency: 'GBP', balance: 50000, scheduled: 0, bills_due: 3000, pending_approvals: 0, safe_to_spend: 47000 },
          { currency: 'USDC', balance: 2_500_000, scheduled: 0, bills_due: 0, pending_approvals: 0, safe_to_spend: 2_500_000 },
        ],
        // 100 LXC held, a 20 LXC schedule this month and a 30 LXC payment waiting for approval: 50 LXC.
        agents: [{ agent_id: 'agt_1', name: 'Researcher', figures: [{ currency: 'LXC', balance: 100 * M, scheduled: 20 * M, bills_due: 0, pending_approvals: 30 * M, safe_to_spend: 50 * M }] }],
      })
    }
    return new Response('null', { status: 404 })
  })
}

async function ask(question: string) {
  const box = await screen.findByRole('textbox', { name: /message/i })
  await waitFor(() => expect(box).not.toBeDisabled())
  fireEvent.change(box, { target: { value: question } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(box).toHaveValue(''))
  const card = (await screen.findAllByTestId('chat-safe-to-spend')).find((c) => c.textContent?.includes(question))
  if (card === undefined) throw new Error(`no card for "${question}"`)
  return within(card).findByTestId('chat-safe-answer')
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('How much can an agent spend, answered in Chat from Lens’s safe to spend (B41.5)', () => {
  it('reads the agent the question names, or the company; any other question goes to the model', () => {
    expect(parseSafeToSpend('How much can Researcher spend?')).toBe('Researcher')
    expect(parseSafeToSpend('how much can agent “Support bot” safely spend this month')).toBe('Support bot')
    expect(parseSafeToSpend('What’s safe to spend for Researcher?')).toBe('Researcher')
    expect(parseSafeToSpend('safe to spend')).toBe('')
    expect(parseSafeToSpend('How much can we spend?')).toBe('')
    expect(parseSafeToSpend('How much can I save?')).toBeNull()
  })

  it('states the agent’s figure and the company’s, with what each is made of', async () => {
    mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const agent = await ask('How much can researcher spend?')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
    expect(within(agent).getByTestId('chat-safe-agent-LXC')).toHaveTextContent('50 LXC safe to spend this month')
    expect(agent).toHaveTextContent('100 LXC held, less 20 LXC scheduled, 0 LXC in bills due and 30 LXC waiting for approval')

    const company = await ask('What is safe to spend?')
    expect(within(company).getByTestId('chat-safe-company-GBP')).toHaveTextContent('£470.00 safe to spend this month')
    expect(company).toHaveTextContent('£30.00 in bills due')
    expect(within(company).getByTestId('chat-safe-company-USDC')).toHaveTextContent('2.50 USDC safe to spend this month')
    expect(company).toHaveTextContent('Researcher: 50 LXC')
  })
})
