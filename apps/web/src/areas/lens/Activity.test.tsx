import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityScreen } from './Activity'
import { ActivityPaymentScreen } from './ActivityPayment'
import { AppMoney } from './money'
import { pressEverything } from '../../test/pressEverything'

// B61.2 — the web's Activity, as the phone has it: every payment in and out of the company's and its agents' accounts,
// newest first, each in its own currency, with who, what and its state in words, a search and filters for agent, kind
// and state. A row opens that payment: an Instant transfer its receipt, any other its own page.

const agent = (id: string, name: string) => ({ id, name, kind: 'agent', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' })
const account = (id: string, currency: string, agent_id = '') => ({
  id, currency, agent_id, purpose: agent_id ? 'agent' : 'company', status: 'open', name: id, balance_minor: 0, test_minor: 0, live_minor: 0,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const statement = (account_id: string, currency: string, lines: unknown[]) => ({
  account_id, currency, opening_minor: 0, in_minor: 0, out_minor: 0, closing_minor: 0, lines,
})

const COMPANY = statement('acct_usd', 'USD', [
  { entry_id: 'ent_kite', line: 1, at: '2026-11-03T10:00:00Z', kind: 'payment_out', amount_minor: -45_000, funding: 'test', counterparty: 'Kite Accounting', memo: 'October bookkeeping', balance_after_minor: 0 },
])
const RESEARCH = statement('acct_rgbp', 'GBP', [
  { entry_id: 'ent_card', line: 1, at: '2026-11-10T09:00:00Z', kind: 'card_charge', amount_minor: -1_250, funding: 'test', counterparty: 'Hetzner', partner_ref: 'pay_1', balance_after_minor: 0 },
  { entry_id: 'ent_itr', line: 1, at: '2026-11-12T08:00:00Z', kind: 'instant_transfer_payout', amount_minor: -500_000, funding: 'test', counterparty: 'Lumen Freight GmbH', memo: 'Instant transfer itr_1 to Lumen Freight GmbH: £5,000.00 paid out', balance_after_minor: 0 },
])

let lines: Record<string, unknown>

beforeEach(() => {
  lines = { acct_usd: COMPANY, acct_rgbp: RESEARCH }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const path = url.split('?')[0]
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [agent('agt_research', 'Research')] })
    if (path === '/api/money/accounts') return json({ accounts: [account('acct_usd', 'USD'), account('acct_rgbp', 'GBP', 'agt_research')] })
    const m = /^\/api\/money\/accounts\/(\w+)\/statement$/.exec(path)
    if (m) return json(lines[m[1]] ?? statement(m[1], 'USD', []))
    if (path === '/api/money/instant-transfers/itr_1')
      return json({ id: 'itr_1', agent_id: 'agt_research', status: 'received', beneficiary_name: 'Lumen Freight GmbH', send_minor: 500_000, send_currency: 'GBP', legs: [] })
    if (path === '/api/money/card-disputes') return json({ disputes: [] })
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show(at = '/activity') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <AppMoney>
          <Routes>
            <Route path="/activity" element={<ActivityScreen />} />
            <Route path="/activity/:account/:entry" element={<ActivityPaymentScreen />} />
            <Route path="/money/pay/instant-transfer/:id" element={<p>The receipt</p>} />
          </Routes>
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const rows = async () => within(await screen.findByTestId('activity')).findAllByTestId('activity-row')

describe('Activity, every payment in and out', () => {
  it('lists an Instant transfer, a card payment and a payment out newest first, each in its own currency and state', async () => {
    show()
    await waitFor(async () => expect((await rows()).length).toBe(3))
    const [itr, card, out] = await rows()
    expect(itr.textContent).toContain('Lumen Freight GmbH')
    expect(itr.textContent).toContain('Instant transfer')
    expect(itr.textContent).toContain('−£5,000.00')
    await waitFor(() => expect(itr.textContent).toContain('Received'))
    expect(card.textContent).toContain('Hetzner')
    expect(card.textContent).toContain('Card payment')
    expect(card.textContent).toContain('Research')
    expect(card.textContent).toContain('−£12.50')
    expect(out.textContent).toContain('Kite Accounting')
    expect(out.textContent).toContain('Company')
    expect(out.textContent).toContain('−$450.00')
    expect(out.textContent).toContain('Paid')
    expect(document.body.textContent).not.toMatch(/LXC/)
    expect(itr.getAttribute('href')).toBe('/money/pay/instant-transfer/itr_1')
    expect(card.getAttribute('href')).toBe('/activity/acct_rgbp/ent_card')
    expect(out.getAttribute('href')).toBe('/activity/acct_usd/ent_kite')
  })

  it('opens a payment on its own page, and an Instant transfer on its receipt', async () => {
    show()
    await waitFor(async () => expect((await rows()).length).toBe(3))
    fireEvent.click((await rows())[2])
    const page = await screen.findByTestId('activity-payment')
    expect(page.textContent).toContain('Kite Accounting')
    expect(page.textContent).toContain('October bookkeeping')
    expect(page.textContent).toContain('−$450.00')
    cleanup()
    show()
    await waitFor(async () => expect((await rows()).length).toBe(3))
    fireEvent.click((await rows())[0])
    expect(await screen.findByText('The receipt')).toBeTruthy()
  })

  it('narrows by agent, kind, state and words', async () => {
    show()
    await waitFor(async () => expect((await rows()).length).toBe(3))
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'company' } })
    expect((await rows()).map((r) => r.textContent)).toEqual([expect.stringContaining('Kite Accounting')])
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'card' } })
    expect((await rows()).map((r) => r.textContent)).toEqual([expect.stringContaining('Hetzner')])
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: '' } })
    await waitFor(() => expect(within(screen.getByLabelText('State')).queryByRole('option', { name: 'Received' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Received' } })
    expect((await rows()).map((r) => r.textContent)).toEqual([expect.stringContaining('Lumen Freight GmbH')])
    fireEvent.change(screen.getByLabelText('State'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bookkeeping' } })
    expect((await rows()).map((r) => r.textContent)).toEqual([expect.stringContaining('Kite Accounting')])
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nothing like it' } })
    expect(await screen.findByText('No payment matches.')).toBeTruthy()
  })

  it('says so when nothing has moved', async () => {
    lines = {}
    show()
    expect(await screen.findByText(/^No payments yet\./)).toBeTruthy()
  })
})

describe('Activity in the app', () => {
  it('has no control that does nothing', async () => {
    const report = await pressEverything('/activity')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(0)
    // Each control is pressed on a fresh render of the whole console, sidebar and all: a minute, not five seconds.
  }, 60_000)
})
