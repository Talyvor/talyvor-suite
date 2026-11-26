import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopUpLink } from './AgentWalletActions'
import { AppMoney } from './money'
import type { Agent } from './agentBankApi'

// B48.44 — https://app.talyvor.com/agents/<id>?top_up=<move>, the link an agent's wallet_topup_link hands its owner
// (Lens B48.39), opens on the agent's page the quote Lens B48.43 reads back by id and a Confirm that posts to Lens
// B48.8's …/wallet-moves/<move>/confirm once; an expired quote says so, and Add money quotes the same top-up again.
// The BFF is mocked at the wire with what those routes answer.

const AGENT = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, owner_user_id: 'u1' } as Agent
const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString()
const move = (over: object) => ({ id: 'wm_ask', agent_id: 'agt_1', route: 'card', sell_minor: 10_000, sell_currency: 'EUR', fee_minor: 150,
  buy_minor: 106_700_000, buy_currency: 'USDC', rate: '1.0820', status: 'quoted', expires_at: IN_AN_HOUR, created_at: '2026-11-25T09:59:30Z', ...over })

function Where() {
  return <span data-testid="where">{useLocation().search}</span>
}

function open(asked: object, link = '/agents/agt_1?top_up=wm_ask') {
  const calls: { method: string; url: string; body: string }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : '' })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/agents/agt_1/wallet-moves/wm_ask' && method === 'GET') return json(asked)
    if (url === '/api/agents/agt_1/wallet-moves/wm_ask/confirm') return json({ ...asked, status: 'posted' })
    if (url === '/api/agents/agt_1/wallet-moves/quote') return json(move({ id: 'wm_new', fee_minor: 160 }))
    if (url === '/api/agents/agt_1/wallet-moves/wm_new/confirm') return json(move({ id: 'wm_new', status: 'posted' }))
    return json({ error: 'no such move' }, 404)
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppMoney>
        <MemoryRouter initialEntries={[link]}>
          <div data-design="pocket">
            <Routes>
              <Route path="/agents/:id" element={<><TopUpLink agent={AGENT} /><Where /></>} />
            </Routes>
          </div>
        </MemoryRouter>
      </AppMoney>
    </QueryClientProvider>,
  )
  return calls
}

const confirms = (calls: ReturnType<typeof open>) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/confirm'))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the top-up link an agent asked for', () => {
  it('opens the quote read by its id, and Confirm, pressed twice, posts to its confirm once', async () => {
    const calls = open(move({}))
    const card = await screen.findByTestId('agent-top-up-link')
    expect(within(card).getByRole('heading', { name: 'Add money to Researcher' })).toBeTruthy()
    expect((await within(card).findByText('You send')).nextSibling?.textContent).toContain('100.00')
    expect(within(card).getByText('Fee').nextSibling?.textContent).toContain('1.50')
    expect(within(card).getByText('1 EUR = 1.0820 USDC')).toBeTruthy()
    expect(within(card).getByTestId('wallet-move-gets').textContent).toContain('106.70')
    const confirm = within(card).getByRole('button', { name: 'Confirm' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(await within(card).findByText(/is in Researcher’s wallet/)).toBeTruthy()
    expect(confirms(calls).map((c) => c.url)).toEqual(['/api/agents/agt_1/wallet-moves/wm_ask/confirm'])
    expect(calls.some((c) => c.url === '/api/agents/agt_1/wallet-moves/wm_ask' && c.method === 'GET')).toBe(true)
  })

  it('says an expired quote has expired, posts nothing, and Add money quotes the same top-up again', async () => {
    const calls = open(move({ expires_at: '2026-11-25T08:00:00Z' }))
    const card = await screen.findByTestId('agent-top-up-link')
    expect(await within(card).findByText('This quote has expired. Nothing moved.')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Add money' }))
    await waitFor(() => expect(within(card).getByText('Fee').nextSibling?.textContent).toContain('1.60'))
    const quoted = calls.filter((c) => c.url === '/api/agents/agt_1/wallet-moves/quote')
    expect(quoted.map((c) => JSON.parse(c.body))).toEqual([{ route: 'card', amount_minor: 10_000, currency: 'EUR' }])
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }))
    await within(card).findByText(/is in Researcher’s wallet/)
    expect(confirms(calls).map((c) => c.url)).toEqual(['/api/agents/agt_1/wallet-moves/wm_new/confirm'])
  })

  it('says a link that is not this agent’s top-up moved nothing, and Not now closes it', async () => {
    const calls = open(move({}), '/agents/agt_1?top_up=wm_gone')
    const card = await screen.findByTestId('agent-top-up-link')
    expect(await within(card).findByText('This top-up link is not one Researcher asked you for, or it has gone. Nothing moved.')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByTestId('agent-top-up-link')).toBeNull())
    expect(screen.getByTestId('where').textContent).toBe('')
    expect(confirms(calls)).toEqual([])
  })
})
