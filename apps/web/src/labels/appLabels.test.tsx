import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../App'
import { RoomBudget } from '../areas/rooms/Room'
import { bodyFor, populatedBff, settleQueries } from '../populatedBff'

// B56.11 — every signed-in money screen carries the label Lens serves for this workspace (GET
// /api/wallets/capabilities' label, talyvor-lens B56.7): Sandbox when it says sandbox, Live when it says live, and
// nothing at all for a capability it gave no label. The real app at each address, on the populated fixture, with only
// the capabilities' answer changed.

const KEYS = [
  'spend_on_talyvor',
  'move_between_own_agents',
  'pay_another_owner',
  'company_credit_line',
  'loans_between_companies',
  'escrow',
  'cash_out',
  'invest_and_trade',
  'agent_card',
  'payments_out',
  'payments_in',
  'currency_accounts',
  'account_details',
  'buy_marketplace_listings',
  'rent_and_subscribe_listings',
]

type Served = 'sandbox' | 'live' | 'unread'

function capabilities(served: Served, except: Record<string, string> = {}) {
  return {
    capabilities: [
      ...KEYS.map((k) => ({ capability: k, name: k, class: 'RED', real_money: false, ...(served === 'unread' ? {} : { label: except[k] ?? served }) })),
      // Rules, approvals, statements and pots move no money of their own: Lens gives them no label.
      { capability: 'rules_approvals_statements_pots', name: 'Rules', class: 'GREEN', real_money: true },
    ],
  }
}

const LISTING = (bodyFor('/api/marketplace/listings') as { listings: { id: string }[] }).listings.find((l) => l.id === 'lst_translate')

async function at(address: string, served: Served, except: Record<string, string> = {}) {
  populatedBff((impl) => void vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
    '/api/wallets/capabilities': capabilities(served, except),
    '/api/marketplace/listings/lst_translate': LISTING,
  })
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  await settleQueries(queryClient, waitFor)
}

/** Each chip in the page's content (the sidebar's is its own test), as its state and the capabilities it states. */
function chips(): string[] {
  const main = document.querySelector('main') ?? document.body
  return [...main.querySelectorAll('[data-status-label]')].map((el) => `${el.getAttribute('data-status-label')} ${el.getAttribute('data-status-key')}`)
}

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  queryClient.clear()
})

const AGENT_CREDIT = 'spend_on_talyvor move_between_own_agents'

// Each address, and the capabilities each of its chips states.
const PLACEMENTS: [string, string[]][] = [
  // B57.19 — /agents is the list; today's agent view, with its chips, is the agent's own address. B57.20: the agent's
  // page above it says it once, on its balance.
  ['/agents/agt_research', [AGENT_CREDIT, AGENT_CREDIT, AGENT_CREDIT, 'payments_out', 'pay_another_owner', 'currency_accounts account_details', 'pay_another_owner', 'pay_another_owner', 'pay_another_owner', 'loans_between_companies', 'escrow', 'invest_and_trade', 'cash_out', 'agent_card', AGENT_CREDIT, 'pay_another_owner', 'company_credit_line', 'loans_between_companies', 'escrow', 'cash_out']],
  // B57.17 — the agents' requests first, then the prepared payments, as w-approvals lists them.
  ['/approvals', ['pay_another_owner', 'payments_out']],
  // B57.24 — one chip, on the agent's statement document.
  ['/statements', [AGENT_CREDIT]],
  ['/approve/:id', ['payments_out']],
  ['/money/pay', ['payments_out']],
  ['/money/invoices', ['payments_in']],
  ['/billing', ['spend_on_talyvor']],
  ['/plans', ['spend_on_talyvor']],
  ['/chat', ['pay_another_owner', 'escrow', 'pay_another_owner']],
  ['/marketplace/selling', ['buy_marketplace_listings rent_and_subscribe_listings']],
  ['/marketplace/listings/lst_translate', ['buy_marketplace_listings rent_and_subscribe_listings']],
]

describe('labels on the signed-in money screens (B56.11)', () => {
  for (const [address, keys] of PLACEMENTS) {
    it(`${address} says Sandbox, Live, or nothing, as Lens serves it`, async () => {
      for (const served of ['sandbox', 'live'] as const) {
        await at(address, served)
        expect(chips(), `${address} served ${served}`).toEqual(keys.map((k) => `${served} ${k}`))
        vi.restoreAllMocks()
        cleanup()
        queryClient.clear()
      }
      await at(address, 'unread')
      expect(chips(), `${address} with no label served`).toEqual([])
    }, 20_000)
  }

  it('the room’s budget says what Lens serves for spending on Talyvor', async () => {
    const wallet = { agent_id: 'agt_room', name: 'Room', balance_ulxc: 5_000_000, monthly_limit_ulxc: 0, spent_this_month_ulxc: 0, max_per_request_ulxc: 0, approval_above_ulxc: 0, budget_max_ulxc: 0, spend_policy: 'owner_only' as never, may_spend: true }
    for (const served of ['sandbox', 'live', 'unread'] as const) {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(capabilities(served)), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <RoomBudget wallet={wallet} />
        </QueryClientProvider>,
      )
      const budget = screen.getByTestId('room-budget')
      if (served === 'unread') {
        await settleQueries(client, waitFor)
        expect(budget.querySelector('[data-status-label]')).toBeNull()
      } else {
        expect((await within(budget).findByText(served === 'live' ? 'Live' : 'Sandbox')).getAttribute('data-status-key')).toBe('spend_on_talyvor')
      }
      vi.restoreAllMocks()
      cleanup()
    }
  })
})

describe('the top bar’s label (B57.118)', () => {
  // The launch pack's design (W2 to W5): the label sits in the top bar, top right on every signed-in screen, before
  // Pause every agent; the sidebar's workspace tile carries none.
  const header = () => document.querySelector('header') as HTMLElement
  const barLabel = () => within(header()).queryAllByText(/^(Live|Sandbox|Building|Status unknown)$/).map((el) => el.textContent)

  it('says Sandbox before Pause every agent while every money capability is sandbox, and the sidebar says nothing', async () => {
    await at('/', 'sandbox')
    expect(barLabel()).toEqual(['Sandbox'])
    const label = within(header()).getByText('Sandbox')
    const pause = within(header()).getByRole('button', { name: /pause every agent/i })
    expect(label.compareDocumentPosition(pause) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: /sections/i })).queryAllByText(/^(Live|Sandbox|Building)$/)).toEqual([])
  })

  it('stays Sandbox while any one is, and says Live once every one is live', async () => {
    await at('/approvals', 'sandbox', { payments_out: 'live' })
    expect(barLabel()).toEqual(['Sandbox'])
    vi.restoreAllMocks()
    cleanup()
    queryClient.clear()
    await at('/settings', 'live')
    expect(barLabel()).toEqual(['Live'])
  })

  it('says nothing while Lens gives no label, and Status unknown when the read failed', async () => {
    await at('/', 'unread')
    expect(barLabel()).toEqual([])
    vi.restoreAllMocks()
    cleanup()
    queryClient.clear()
    populatedBff((impl) => void vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
      '/api/wallets/capabilities': undefined,
    })
    window.history.pushState({}, '', '/')
    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })
    await settleQueries(queryClient, waitFor)
    await waitFor(() => expect(barLabel()).toEqual(['Status unknown']))
  })
})
