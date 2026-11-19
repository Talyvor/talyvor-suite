import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayInstantTransferScreen } from './InstantTransfer'
import { InstantTransferScreen } from './InstantTransferReceipt'
import { AccountStatement } from './AccountStatement'
import { AppMoney } from './money'
import { PlaceTabs } from '../../components/PlaceTabs'

// B59.19 — Instant transfer on the web (launch pack 4.1, design W3 and P7 to P10): the quote card's fields and its 30
// seconds counting down, with a fresh quote when they run out; a send Lens refuses by its field, and one it asks the
// owner to approve, signed and sent again at a fresh quote; each progress state; the receipt with both conversions and
// the on-chain reference; and the statement's one line that opens the legs. A fiat-only account has no entry at all:
// KindAndType.test.tsx holds that for all six kinds and types.

/** What a person reads: <Money> writes its figures with no-break spaces. */
const read = (el: Element | null) => (el?.textContent ?? '').replace(/\u00a0/g, ' ')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const REMY_USD = { id: 'macc_remy', agent_id: 'agt_remy', currency: 'USD', purpose: 'agent' as const, status: 'open', name: 'USD account', balance_minor: 620_000, test_minor: 620_000, live_minor: 0 }
const LUMEN = {
  id: 'payee_lf', name: 'Lumen Freight GmbH', country: 'DE', iban: 'DE89370400440532014417', check: 'exact_match', checked_by: 'test', checked_at: '2026-11-01T09:00:00Z', needs_confirmation: false, created_at: '2026-11-01T09:00:00Z',
  cooling_off_until: new Date(Date.now() + 86_400_000).toISOString(),
}

function quote(n: number, lifeSeconds = 30) {
  const created = new Date()
  return {
    id: `itq_${n}`, to: 'bank_account', country: 'DE', send_minor: 500_000, send_currency: 'USD', fee_bps: 25, fee_minor: 1_250,
    rate: '0.92100000', receive_minor: 459_348, receive_currency: 'EUR', arrives_in_seconds: true,
    created_at: created.toISOString(), expires_at: new Date(created.getTime() + lifeSeconds * 1000).toISOString(),
  }
}

const LEGS = [
  { id: 'itr_7Q2M:convert', leg: 'convert', done: true, partner_ref: 'cv_1', sell: { minor: 500_000, currency: 'USD' }, buy: { minor: 4_987_500_000, currency: 'USDC' } },
  { id: 'itr_7Q2M:move', leg: 'move', done: true, partner_ref: '0x9f3ac41e', sell: { minor: 4_987_500_000, currency: 'USDC' }, buy: { minor: 4_987_500_000, currency: 'USDC' } },
  { id: 'itr_7Q2M:payout', leg: 'payout', done: true, partner_ref: 'po_1', conversion_ref: 'cv_2', sell: { minor: 4_987_500_000, currency: 'USDC' }, buy: { minor: 459_348, currency: 'EUR' } },
]
const transfer = (status: string) => ({
  id: 'itr_7Q2M', agent_id: 'agt_remy', from_account_id: 'macc_remy', to_payee_id: 'payee_lf', beneficiary_name: 'Lumen Freight GmbH',
  send_minor: 500_000, send_currency: 'USD', fee_minor: 1_250, receive_minor: 459_348, receive_currency: 'EUR', rate: '0.92100000',
  arrives_in_seconds: true, status, legs: LEGS, reversal_entry_ids: [], created_at: '2026-11-14T10:42:07Z', updated_at: '2026-11-14T10:42:19Z',
})

let quotes: number
let quoteLife: number
let sends: { body: Record<string, unknown>; key: string | null }[]
let sendAnswers: Response[]
let decided: string[]
let status: string

beforeEach(() => {
  quotes = 0
  quoteLife = 30
  sends = []
  sendAnswers = []
  decided = []
  status = 'received'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const path = url.split('?')[0]
    if (path === '/api/workspace/account') return json({ account_type: 'business', money_kind: 'hybrid' })
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_remy', name: 'Remy', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }] })
    if (path === '/api/money/accounts') return json({ accounts: [REMY_USD] })
    if (path === '/api/money/payees') return json({ payees: [LUMEN] })
    if (path === '/api/money/instant-transfers/quote') {
      quotes += 1
      return json(quote(quotes, quoteLife), 201)
    }
    if (path === '/api/agents/agt_remy/instant-transfers') {
      sends.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('Idempotency-Key') })
      return sendAnswers.shift() ?? json(transfer('received'))
    }
    if (path === '/api/agents/approvals/apr_1/challenge') return json({ challenge: 'Y2g', allow_credentials: [] })
    if (path === '/api/agents/approvals/apr_1/approve' || path === '/api/agents/approvals/apr_1/deny') {
      decided.push(path)
      return json({ id: 'apr_1', status: 'approved' })
    }
    if (path === '/api/money/instant-transfers/itr_7Q2M') return json(transfer(status))
    if (path === '/api/money/accounts/macc_remy/statement')
      return json({
        account_id: 'macc_remy', currency: 'USD', opening_minor: 620_000, in_minor: 0, out_minor: 500_000, closing_minor: 120_000,
        lines: [
          { entry_id: 'ent_conv', line: 1, at: '2026-11-14T10:42:07Z', kind: 'instant_transfer_convert', amount_minor: -500_000, funding: 'test', counterparty: 'sandbox', memo: 'Instant transfer itr_7Q2M to Lumen Freight GmbH: $5,000.00 sent', balance_after_minor: 120_000 },
          { entry_id: 'ent_in', line: 1, at: '2026-11-13T09:00:00Z', kind: 'payment_in', amount_minor: 620_000, funding: 'test', counterparty: 'Fennel Labs', memo: 'INV-1', balance_after_minor: 620_000 },
        ],
      })
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show(at: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <AppMoney>
          {/* B57.171 — the shell draws Pay's row of pages above each of them. */}
          <div data-design="pocket">
            <PlaceTabs />
          </div>
          <Routes>
            <Route path="/money/pay" element={<p>Pay</p>} />
            <Route path="/money/pay/instant-transfer" element={<PayInstantTransferScreen />} />
            <Route path="/money/pay/instant-transfer/:id" element={<InstantTransferScreen />} />
            <Route path="/statement" element={<AccountStatement account={REMY_USD} agent={null} />} />
          </Routes>
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Pay › Instant transfer, to Lumen Freight's bank, from Remy's US dollars: $5,000.00. */
async function fillIn() {
  show('/money/pay/instant-transfer')
  fireEvent.click(await screen.findByRole('radio', { name: /An outside bank account/ }))
  fireEvent.change(await screen.findByRole('combobox', { name: 'Recipient' }), { target: { value: 'payee_lf' } })
  fireEvent.change(await screen.findByRole('textbox', { name: 'Amount' }), { target: { value: '5000' } })
  return screen.findByTestId('instant-quote')
}

describe('the quote card', () => {
  it('shows you send, rate, fee and they get, arrives in seconds, locked for 30 seconds and counting down', async () => {
    const card = await fillIn()
    await within(card).findByText('$5,000.00')
    expect(within(card).getByText('1 USD = 0.9210 EUR')).toBeTruthy()
    expect(within(card).getByText('$12.50')).toBeTruthy()
    expect(read(within(card).getByTestId('instant-they-get'))).toBe('€4,593.48')
    expect(read(within(card).getByTestId('instant-arrives'))).toBe('Arrives in seconds')
    expect(read(card)).toContain('Locked for 30 seconds')
    expect(read(within(card).getByTestId('instant-seconds-left'))).toBe('30 seconds left')
    await waitFor(() => expect(read(within(card).getByTestId('instant-seconds-left'))).toBe('29 seconds left'), { timeout: 2500 })
    expect(quotes).toBe(1)
  })

  it('takes a fresh quote when the seconds run out', async () => {
    quoteLife = 1
    const card = await fillIn()
    await within(card).findByText('$5,000.00')
    await waitFor(() => expect(quotes).toBeGreaterThanOrEqual(2), { timeout: 4000 })
  })
})

describe('sending it', () => {
  it('sends the quote under one key and opens its progress', async () => {
    const card = await fillIn()
    await within(card).findByText('$5,000.00')
    fireEvent.click(within(card).getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('instant-receipt')
    expect(sends).toHaveLength(1)
    expect(sends[0].body).toEqual({ quote_id: 'itq_1', to_payee_id: 'payee_lf' })
    expect(sends[0].key).toBeTruthy()
  })

  it('an agent without the rule is told so from the field, with the way to its rules', async () => {
    sendAnswers.push(json({ error: 'This agent’s rules do not let it use Instant transfer (may_instant_transfer)', code: 'agent_rule', field: 'may_instant_transfer' }, 403))
    const card = await fillIn()
    await within(card).findByText('$5,000.00')
    fireEvent.click(within(card).getByRole('button', { name: 'Continue' }))
    const refused = await within(card).findByTestId('instant-refused')
    expect(read(refused)).toContain('Remy can’t use Instant transfer. Turn it on in Remy’s rules.')
    expect(read(refused)).not.toContain('may_instant_transfer')
    expect(within(refused).getByRole('link', { name: 'Open Remy’s rules' }).getAttribute('href')).toBe('/agents/agt_remy/rules')
  })

  it('B61.80 — more than the agent holds says to lower the amount or add money', async () => {
    sendAnswers.push(json({ error: 'the account holds $6,200.00 of test money' }, 409))
    const card = await fillIn()
    await within(card).findByText('$5,000.00')
    fireEvent.click(within(card).getByRole('button', { name: 'Continue' }))
    const refused = await within(card).findByTestId('instant-refused')
    expect(read(refused)).toContain('Remy’s US dollar balance holds $6,200.00. Lower the amount or add money.')
    expect(read(refused)).not.toMatch(/top.?up/i)
  })

  it('when Lens asks for the owner’s approval, approving sends it again at a fresh quote under the same key', async () => {
    sendAnswers.push(json({ error: 'This request would cost up to $5,000.00, above the agent’s approval amount. Approval apr_1 must be approved by the workspace’s owner before it is retried' }, 403))
    const card = await fillIn()
    await within(card).findByText('$5,000.00')
    fireEvent.click(within(card).getByRole('button', { name: 'Continue' }))
    const sheet = await screen.findByRole('dialog', { name: 'Approve this Instant transfer' })
    expect(read(sheet)).toContain('This approves this payment only.')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve with your passkey' }))
    await screen.findByTestId('instant-receipt')
    expect(decided).toEqual(['/api/agents/approvals/apr_1/approve'])
    expect(sends).toHaveLength(2)
    expect(sends[1].body.quote_id).not.toBe(sends[0].body.quote_id)
    expect(sends[1].key).toBe(sends[0].key)
  })
})

describe('its progress', () => {
  const cases: [string, string[], string][] = [
    ['sent', ['done', 'current', 'next', 'next'], 'Sent'],
    ['converted', ['done', 'done', 'current', 'next'], 'Converted'],
    ['on_its_way', ['done', 'done', 'current', 'next'], 'On its way'],
    ['reversed', ['failed', 'next', 'next', 'next'], 'Didn’t go through'],
  ]
  for (const [state, steps, eyebrow] of cases) {
    it(`${state}: ${eyebrow}`, async () => {
      status = state
      show('/money/pay/instant-transfer/itr_7Q2M')
      const progress = await screen.findByTestId('instant-progress')
      expect(read(within(progress).getByTestId('instant-status'))).toBe(eyebrow)
      expect(within(progress).getAllByTestId('instant-step').map((s) => s.getAttribute('data-state'))).toEqual(steps)
      expect(within(progress).getAllByTestId('instant-step').map((s) => s.textContent?.split(/From|US dollars|Moving|They get/)[0])).toEqual(
        state === 'reversed' ? ['Didn’t go through', 'Converted', 'On its way', 'Received'] : ['Sent', 'Converted', 'On its way', 'Received'],
      )
      if (state === 'reversed') expect(read(within(progress).getByTestId('instant-reversed'))).toContain('The full $5,000.00 is back in Remy’s US dollar balance.')
    })
  }
})

describe('B57.164: the form as W3 draws it', () => {
  it('has Pay’s pages above it, Instant transfer on', async () => {
    show('/money/pay/instant-transfer')
    const tabs = await screen.findByRole('tablist', { name: 'Pay' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['One payment', 'Invoices', 'Instant transfer', 'Standing orders', 'Mandates', 'Payout batches'])
    expect(within(tabs).getByRole('tab', { name: 'Instant transfer' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(within(tabs).getByRole('tab', { name: 'One payment' }))
    expect(await screen.findByText('Pay')).toBeTruthy()
  })

  it('draws the picked payee as a card, with New payee while Lens still counts it new', async () => {
    await fillIn()
    const card = await screen.findByTestId('instant-recipient')
    expect(read(card)).toBe('LFLumen Freight GmbHGermany · account ending 4417 · gets eurosNew payee')
    expect(read(screen.getByTestId('instant-holds'))).toBe('US dollar balance · holds $6,200.00')
  })
})

describe('B57.164: progress as P9 draws it', () => {
  it('stamps when it was sent and says the step under way is now', async () => {
    status = 'on_its_way'
    show('/money/pay/instant-transfer/itr_7Q2M')
    const steps = await screen.findAllByTestId('instant-step')
    const sent = new Date('2026-11-14T10:42:07Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    expect(read(steps[0])).toContain(sent)
    expect(read(steps[2]).endsWith('Now')).toBe(true)
    expect(read(steps[3])).not.toContain('Now')
  })
})

describe('the receipt', () => {
  it('takes the place of the progress once it lands, and downloads as a file', async () => {
    const saved: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => {
      saved.push(b)
      return 'blob:receipt'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    show('/money/pay/instant-transfer/itr_7Q2M')
    const receipt = await screen.findByTestId('instant-receipt')
    expect(screen.queryByTestId('instant-progress')).toBeNull()
    expect(read(within(receipt).getByTestId('instant-status'))).toBe('Received')
    expect(read(receipt)).toContain('arrived in 12 seconds')
    fireEvent.click(within(receipt).getByRole('button', { name: 'Download receipt' }))
    expect(saved).toHaveLength(1)
    const text = await new Promise<string>((done) => {
      const r = new FileReader()
      r.onload = () => done(String(r.result))
      r.readAsText(saved[0])
    })
    expect(text).toContain('They got: €4,593.48')
    expect(text).toContain('1. $4,987.50 to 4,987.50 USDC · Rate 1 USD = 1.0000 USDC')
    expect(text).toContain('On-chain reference: 0x9f3ac41e')
    expect(text).toContain('Transfer ID: itr_7Q2M')
  })

  it('shows both conversions and the on-chain reference', async () => {
    show('/money/pay/instant-transfer/itr_7Q2M')
    const receipt = await screen.findByTestId('instant-receipt')
    expect(read(receipt)).toContain('$5,000.00')
    expect(read(receipt)).toContain('€4,593.48')
    const conversions = read(within(receipt).getByTestId('instant-conversions'))
    expect(conversions).toContain('$4,987.50 to 4,987.50 USDC')
    expect(conversions).toContain('Rate 1 USD = 1.0000 USDC')
    expect(conversions).toContain('4,987.50 USDC to €4,593.48')
    expect(conversions).toContain('Rate 1 USDC = 0.9210 EUR')
    expect(read(within(receipt).getByTestId('instant-onchain-ref'))).toBe('0x9f3ac41e')
    expect(within(receipt).getByRole('button', { name: 'Copy the on-chain reference' })).toBeTruthy()
    expect(read(receipt)).toContain('itr_7Q2M')
  })
})

describe('the statement', () => {
  it('groups the transfer’s legs under one line that opens them', async () => {
    show('/statement')
    const line = await screen.findByTestId('account-statement-instant')
    expect(screen.getAllByTestId('account-statement-instant')).toHaveLength(1)
    const open = within(line).getByRole('button', { name: 'Instant transfer to Lumen Freight GmbH' })
    expect(read(line)).toContain('$5,000.00')
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    const legs = await within(line).findByTestId('instant-legs')
    expect(read(legs)).toContain('Convert · US dollars to USDC')
    expect(read(legs)).toContain('Move · on chain')
    expect(read(legs)).toContain('Pay out · to their bank')
    expect(read(legs)).toContain('Fee$12.50')
    expect(within(legs).getByRole('link', { name: 'See the receipt' }).getAttribute('href')).toBe('/money/pay/instant-transfer/itr_7Q2M')
  })
})
