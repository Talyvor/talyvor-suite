import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CurrencyAccount } from './agentBankApi'
import { LowBalanceCard } from './LowBalanceCard'
import { AppMoney } from './money'

// B28.61 — an agent's low-balance alert on its page: the owner sets the amount an account is alerted below, which reaches
// Lens B28.334's PUT /v1/money/low-balance as {agent_id, currency, threshold_minor}; the card then reads it back, with
// Below while the account holds less, and lists the alerts Lens wrote for this agent, one an hour.

const GBP: CurrencyAccount = { id: 'acc_gbp', agent_id: 'agt_1', currency: 'GBP', purpose: 'agent', status: 'open', name: 'Pound account', balance_minor: 1_500, test_minor: 1_500, live_minor: 0 }

function mockBff(alerts: unknown[] = []) {
  let thresholds: Record<string, unknown>[] = []
  const sent: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push(`${method} ${url} ${String(init?.body ?? '')}`.trim())
    if (url === '/api/money/low-balance' && method === 'PUT') {
      const b = JSON.parse(String(init?.body)) as { agent_id: string; currency: string; threshold_minor: number }
      const t = { id: 'bth_1', ...b, balance_minor: GBP.balance_minor, has_account: true, below: GBP.balance_minor < b.threshold_minor }
      thresholds = [t]
      return json(t)
    }
    if (url === '/api/money/low-balance/bth_1' && method === 'DELETE') {
      thresholds = []
      return json({ deleted: 'bth_1' })
    }
    if (url === '/api/money/low-balance') return json({ thresholds })
    if (url === '/api/money/low-balance/alerts') return json({ alerts })
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
          <LowBalanceCard agent={{ id: 'agt_1', name: 'Research' }} accounts={accounts} />
        </section>
      </AppMoney>
    </QueryClientProvider>,
  )
}

const text = (el: Element) => (el.textContent ?? '').replace(/ /g, ' ')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('low-balance alert on an agent’s page (B28.61)', () => {
  it('sets the amount an account is alerted below, and shows Below while it holds less', async () => {
    const { sent } = mockBff()
    renderCard()
    const row = await screen.findByTestId('low-balance-GBP')
    fireEvent.change(within(row).getByLabelText('Low balance amount, GBP'), { target: { value: '20' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(text(screen.getByTestId('low-balance-GBP'))).toContain('Alert below £20.00'))
    expect(text(screen.getByTestId('low-balance-GBP'))).toContain('Below')
    expect(sent).toEqual(['PUT /api/money/low-balance {"agent_id":"agt_1","currency":"GBP","threshold_minor":2000}'])
  })

  it('removes a low-balance alert', async () => {
    const { sent } = mockBff()
    renderCard()
    const row = await screen.findByTestId('low-balance-GBP')
    fireEvent.change(within(row).getByLabelText('Low balance amount, GBP'), { target: { value: '20' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the low balance alert on the Pound account' }))

    expect(await screen.findByLabelText('Low balance amount, GBP')).toBeTruthy()
    expect(sent[1]).toBe('DELETE /api/money/low-balance/bth_1 {}')
  })

  it('lists the alerts Lens wrote for this agent and no other', async () => {
    mockBff([
      { id: 'lba_2', agent_id: 'agt_1', currency: 'GBP', hour_start: '2026-11-19T10:00:00Z', balance_minor: 1_500, threshold_minor: 2_000, created_at: '2026-11-19T10:01:00Z' },
      { id: 'lba_9', agent_id: 'agt_other', currency: 'GBP', hour_start: '2026-11-19T10:00:00Z', balance_minor: 100, threshold_minor: 2_000, created_at: '2026-11-19T10:01:00Z' },
    ])
    renderCard()
    expect(text(await screen.findByTestId('low-balance-alert-lba_2'))).toContain('£15.00, below £20.00')
    expect(screen.queryByTestId('low-balance-alert-lba_9')).toBeNull()
  })

  // B57.201 — drawn as Pocket draws a list the owner changes (w-budgets' Your budgets): a white card under its own
  // heading, and Remove the danger button named for what it removes.
  it('is drawn in Pocket: a heading, and Remove the danger button named for its account', async () => {
    mockBff()
    renderCard()
    expect(await screen.findByRole('heading', { name: 'Low balance alert' })).toBeTruthy()
    const row = await screen.findByTestId('low-balance-GBP')
    fireEvent.change(within(row).getByLabelText('Low balance amount, GBP'), { target: { value: '20' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
    const remove = await screen.findByRole('button', { name: 'Remove the low balance alert on the Pound account' })
    expect(remove.className).toContain('text-danger')
  })

  it('says there is no balance to watch while the agent has no account', async () => {
    mockBff()
    renderCard([])
    expect(await screen.findByText('Research has no account yet, so there is no balance to watch.')).toBeTruthy()
  })
})
