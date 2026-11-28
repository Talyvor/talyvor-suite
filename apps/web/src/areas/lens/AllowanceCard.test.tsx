import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CurrencyAccount } from './agentBankApi'
import { AllowanceCard } from './AllowanceCard'
import { AppMoney } from './money'

// B28.33 — an agent's monthly allowance on its page: the owner sets an amount, a day of the month and sweep-back, which
// reaches Lens B28.309's PUT /v1/money/allowances as {agent_id, currency, amount_minor, day_of_month, sweep_back}; the card
// then reads it back with its next day, lists the months Lens paid (one each), and stops it.

const GBP: CurrencyAccount = { id: 'acc_gbp', agent_id: 'agt_1', currency: 'GBP', purpose: 'agent', status: 'open', name: 'Pound account', balance_minor: 750, test_minor: 750, live_minor: 0 }
const USDC: CurrencyAccount = { ...GBP, id: 'acc_usdc', currency: 'USDC', name: 'USDC account' }

function mockBff(runs: unknown[] = []) {
  let allowances: Record<string, unknown>[] = []
  const sent: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push(`${method} ${url} ${String(init?.body ?? '')}`.trim())
    if (url === '/api/money/allowances' && method === 'PUT') {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>
      const a = { id: 'mal_1', ...b, funding: 'test', next_run_at: '2026-12-03T00:00:00Z', created_at: '2026-11-28T10:00:00Z' }
      allowances = [a]
      return json(a)
    }
    if (url === '/api/money/allowances/mal_1' && method === 'DELETE') {
      allowances = allowances.map((a) => ({ ...a, stopped_at: '2026-11-28T11:00:00Z' }))
      return new Response(null, { status: 204 })
    }
    if (url === '/api/money/allowances?agent_id=agt_1') return json({ allowances })
    if (url === '/api/money/allowances/mal_1/runs') return json({ runs })
    return new Response('null', { status: 404 })
  })
  return { sent }
}

function renderCard(accounts: CurrencyAccount[] = [GBP]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AppMoney>
        <section data-design="pocket">
          <AllowanceCard agent={{ id: 'agt_1', name: 'Research' }} accounts={accounts} />
        </section>
      </AppMoney>
    </QueryClientProvider>,
  )
}

const text = (el: Element) => (el.textContent ?? '').replace(/ /g, ' ')

async function setTwentyOnTheThird() {
  const row = await screen.findByTestId('allowance-GBP')
  fireEvent.change(within(row).getByLabelText('Allowance amount, GBP'), { target: { value: '20' } })
  fireEvent.change(within(row).getByLabelText('Allowance day, GBP'), { target: { value: '3' } })
  fireEvent.click(within(row).getByRole('switch', { name: 'Sweep back, GBP' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('monthly allowance on an agent’s page (B28.33)', () => {
  it('sets an amount, a day and sweep-back, and reads it back with its next day', async () => {
    const { sent } = mockBff()
    renderCard()
    await setTwentyOnTheThird()

    await waitFor(() => expect(text(screen.getByTestId('allowance-GBP'))).toContain('£20.00 a month, on the 3rd'))
    expect(text(screen.getByTestId('allowance-GBP'))).toContain('Unspent goes back')
    expect(text(screen.getByTestId('allowance-GBP'))).toContain('Next paid on 3 December 2026')
    expect(sent).toEqual(['PUT /api/money/allowances {"agent_id":"agt_1","currency":"GBP","amount_minor":2000,"day_of_month":3,"sweep_back":true}'])
  })

  it('lists each month Lens paid once, with what went back first', async () => {
    mockBff([{ allowance_id: 'mal_1', period: '2026-11', swept_minor: 750, funded_minor: 2000, status: 'funded', created_at: '2026-11-03T00:01:00Z' }])
    renderCard()
    await setTwentyOnTheThird()

    expect(text(await screen.findByTestId('allowance-month-GBP-2026-11'))).toBe('November 2026: £20.00 paid in, £7.50 back to the company')
    expect(within(screen.getByTestId('allowance-months-GBP')).getAllByText(/November 2026/)).toHaveLength(1)
  })

  it('stops an allowance, and the form comes back', async () => {
    const { sent } = mockBff()
    renderCard()
    await setTwentyOnTheThird()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the allowance on the Pound account' }))

    expect(await screen.findByLabelText('Allowance amount, GBP')).toBeTruthy()
    expect(sent[1]).toBe('DELETE /api/money/allowances/mal_1 {}')
  })

  // B57.229 — drawn as B57.201 drew the Low balance alert above it: a white card under its own heading, a hairline between
  // the months Lens paid, and Stop the danger button named for the account it stops.
  it('is drawn in Pocket: a heading, the months as hairline rows, and Stop the danger button named for its account', async () => {
    mockBff([{ allowance_id: 'mal_1', period: '2026-11', swept_minor: 0, funded_minor: 2000, status: 'funded', created_at: '2026-11-03T00:01:00Z' }])
    renderCard()
    expect(await screen.findByRole('heading', { name: 'Monthly allowance' })).toBeTruthy()
    await setTwentyOnTheThird()
    const stop = await screen.findByRole('button', { name: 'Stop the allowance on the Pound account' })
    expect(stop.className).toContain('text-danger')
    expect((await screen.findByTestId('allowance-month-GBP-2026-11')).className).toContain('border-line')
  })

  it('offers no allowance on a USDC account, which Lens does not pay', async () => {
    mockBff()
    renderCard([USDC])
    expect(await screen.findByText('Research has no pound, euro or dollar account yet, so there is nowhere to pay an allowance.')).toBeTruthy()
  })
})
