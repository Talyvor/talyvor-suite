import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatementsScreen } from './WalletScreens'
import { AgentCardPanel } from './AgentCardPanel'
import { AppMoney } from './money'

// B59.25 — on a card payment's statement line, "Dispute this payment" with a reason, and where the dispute stands
// afterwards; a merchant's refund as its own line; and Export, every card payment of a date range as Lens's CSV.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const charge = (n: number, merchant: string, minor: number) => ({
  entry_id: `ent_${n}`, line: 1, at: `2026-11-0${n}T10:00:00Z`, kind: 'card_charge', amount_minor: -minor, funding: 'test',
  counterparty: merchant, memo: merchant, partner_ref: `iauth_${n}`, balance_after_minor: 0,
})
const dispute = (n: number, merchant: string, status: string, credited = 0) => ({
  id: `cdsp_${n}`, payment_id: `iauth_${n}`, agent_id: 'agt_research', card_id: 'card_1', merchant, amount_minor: 3000, currency: 'USD',
  reason: 'Charged twice', status, credited_minor: credited, created_at: '2026-11-08T09:00:00Z',
})
const STATEMENT = {
  account_id: 'acct_usd', currency: 'USD', opening_minor: 10_000, in_minor: 4_000, out_minor: 15_000, closing_minor: -1_000,
  lines: [
    charge(1, 'Cloud Host', 3000),
    charge(2, 'Data Feed', 3000),
    charge(3, 'Map Tiles', 3000),
    charge(4, 'Search API', 3000),
    charge(5, 'Print Shop', 3000),
    { entry_id: 'ent_6', line: 1, at: '2026-11-06T10:00:00Z', kind: 'card_refund', amount_minor: 1000, funding: 'test', counterparty: 'Print Shop', memo: 'Print Shop', partner_ref: 'iauth_5', balance_after_minor: 0 },
  ],
}

let asked: { method: string; url: string; body: string }[]
let disputes: ReturnType<typeof dispute>[]

beforeEach(() => {
  asked = []
  disputes = [dispute(1, 'Cloud Host', 'opened'), dispute(2, 'Data Feed', 'with_issuer'), dispute(3, 'Map Tiles', 'won', 3000), dispute(4, 'Search API', 'lost')]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    asked.push({ method, url, body: String(init?.body ?? '') })
    const path = url.split('?')[0]
    if (path === '/api/agents')
      return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [
        { id: 'agt_research', name: 'Research', kind: 'agent', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }] })
    if (path === '/api/money/accounts')
      return json({ accounts: [{ id: 'acct_usd', currency: 'USD', agent_id: '', purpose: 'company', status: 'open', name: 'acct_usd', balance_minor: 0, test_minor: 0, live_minor: 0 }] })
    if (path === '/api/money/accounts/acct_usd/statement') return json(STATEMENT)
    if (path === '/api/agents/agt_research/statement') return json({ lines: [] })
    if (path === '/api/money/card-disputes' && method === 'POST') {
      const made = { ...dispute(5, 'Print Shop', 'with_issuer'), reason: JSON.parse(String(init?.body)).reason }
      disputes = [made, ...disputes]
      return json(made, 201)
    }
    if (path === '/api/money/card-disputes') return json({ card_disputes: disputes })
    if (path === '/api/money/card-refunds')
      return json({ card_refunds: [{ id: 'sbx_re_1', payment_id: 'iauth_5', agent_id: 'agt_research', card_id: 'card_1', merchant: 'Print Shop',
        amount_minor: 1000, currency: 'USD', credited_minor: 1000, created_at: '2026-11-06T10:00:00Z' }] })
    if (path === '/api/agents/agt_research/card')
      return json({ card: { id: 'card_1', agent_id: 'agt_research', last4: '4242', exp_month: 12, exp_year: 2029, currency: 'usd', livemode: false,
        created_at: '2026-10-01T09:00:00Z' }, authorizations: [] })
    if (path === '/api/money/card-exports')
      return new Response('type,at,id\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show(at = '/statements?wallet=acct_usd') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <AppMoney>
          <StatementsScreen />
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The statement's row whose words begin with merchant's name and kind. */
const row = async (merchant: string, kind = 'Card payment') => {
  const what = await screen.findByText((_, el) => el?.getAttribute('data-testid') === 'account-statement-what' && el.textContent?.startsWith(`${merchant} · ${kind}`) === true)
  return what.closest('tr') as HTMLElement
}

describe('card disputes and refunds on the statement', () => {
  it('disputes a card payment with a reason, sends Lens the payment and the reason, and then says the issuer has it', async () => {
    show()
    const line = await row('Print Shop')
    fireEvent.click(await within(line).findByRole('button', { name: 'Dispute this payment' }))
    const form = within(line).getByTestId('dispute-form')
    const send = () => within(form).getByRole('button', { name: 'Send dispute' }) as HTMLButtonElement
    expect(send().disabled).toBe(true)
    expect(within(form).getByText('Say why you are disputing it first.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Why are you disputing it?'), { target: { value: '  Never delivered  ' } })
    expect(send().disabled).toBe(false)
    fireEvent.click(send())
    expect(await within(line).findByText('With the card issuer')).toBeTruthy()
    const posted = asked.filter((a) => a.method === 'POST')
    expect(posted.map((a) => [a.url, JSON.parse(a.body)])).toEqual([['/api/money/card-disputes', { payment_id: 'iauth_5', reason: 'Never delivered' }]])
    expect(within(line).queryByRole('button', { name: 'Dispute this payment' })).toBeNull()
  })

  it('shows each state of a dispute on its payment, with what came back once it was won', async () => {
    show()
    const state = async (merchant: string) => within(await row(merchant)).findByTestId('dispute-state')
    expect((await state('Cloud Host')).textContent).toBe('Dispute opened')
    expect((await state('Data Feed')).textContent).toBe('With the card issuer')
    expect((await state('Map Tiles')).textContent?.replace(/ /g, ' ')).toBe('Dispute won · $30.00 back')
    expect((await state('Search API')).textContent).toBe('Dispute lost')
  })

  it('shows a merchant’s refund as its own line, money in, under the payment it refunds', async () => {
    show()
    const refund = await row('Print Shop', 'Refund')
    expect(within(refund).getByTestId('account-statement-what').textContent).toBe('Print Shop · Refund · Print Shop')
    expect(refund.querySelector('[data-money]')?.textContent?.replace(/ /g, ' ')).toBe('+$10.00')
    expect(within(refund).queryByRole('button', { name: 'Dispute this payment' })).toBeNull()
  })
})

describe('disputes and refunds on the agent’s card', () => {
  it('lists the card’s disputes with their state and its refunds with what came back', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AppMoney>
            <AgentCardPanel agent={{ id: 'agt_research', name: 'Research', kind: 'agent', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' } as never} />
          </AppMoney>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const box = await screen.findByTestId('card-disputes-refunds')
    expect(within(box).getAllByTestId('dispute-state').map((d) => d.textContent?.replace(/\u00a0/g, ' '))).toEqual(['Dispute opened', 'With the card issuer', 'Dispute won · $30.00 back', 'Dispute lost'])
    const refund = within(box).getByTestId('card-refund')
    expect(refund.textContent).toMatch(/^Print Shop · Refund · /)
    expect(refund.querySelector('[data-money]')?.textContent?.replace(/\u00a0/g, ' ')).toBe('+$10.00')
    expect(within(screen.getByTestId('card-export')).getByRole('button', { name: 'Export' })).toBeTruthy()
  })
})

describe('Export on Statements', () => {
  it('asks Lens for the card payments of the chosen days and saves its CSV', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const saved: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    show()
    const form = await screen.findByTestId('card-export')
    fireEvent.change(within(form).getByLabelText('Card payments from'), { target: { value: '2026-10-01' } })
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-10-31' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(saved).toEqual(['card-payments-2026-10-01-to-2026-10-31.csv']))
    expect(asked.filter((a) => a.url.startsWith('/api/money/card-exports')).map((a) => a.url)).toEqual(['/api/money/card-exports?from=2026-10-01&to=2026-10-31'])
  })
})
