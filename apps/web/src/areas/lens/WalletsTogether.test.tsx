import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SnackHost } from '@talyvor/ui/pocket'
import { WalletsScreen } from './Wallets'
import { AppMoney } from './money'

// B48.19 — the owner's money in one place, on Wallets: an agent's wallet dragged onto another's opens the move between
// them, quoted by Lens's route wallet and moved once however many times Move is pressed; how many approvals wait, a
// crypto send to a new address among them, with the way to Approvals; and every wallet's month in one download.

const read = (el: Element | null) => (el?.textContent ?? '').replace(/ /g, ' ')
// Money keeps its figure and currency together with a no-break space; this reads them as one space.
const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s/g, ' ')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const acct = (id: string, currency: string, purpose: 'company' | 'agent', minor: number, agent_id = '') => ({
  id, agent_id, currency, purpose, status: 'open', name: `${currency} account`, balance_minor: minor, test_minor: minor, live_minor: 0,
})
const ACCOUNTS = [
  acct('macc_usdc', 'USDC', 'company', 14_000_000_000),
  acct('macc_remy', 'USDC', 'agent', 620_000_000, 'agt_remy'),
  acct('macc_iris', 'USDC', 'agent', 80_000_000, 'agt_iris'),
]
const agent = (id: string, name: string) => ({ id, name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' })
const MOVE = { id: 'wmove_1', agent_id: 'agt_iris', route: 'wallet', sell_minor: 25_000_000, sell_currency: 'USDC', fee_minor: 0, buy_minor: 25_000_000, buy_currency: 'USDC', rate: '1', created_at: '2026-11-25T09:00:00Z' }
const SEND = { id: 'csend_1', agent_id: 'agt_remy', direction: 'out', status: 'awaiting_owner', to: '0x1111111111111111111111111111111111111111', to_kind: 'address', network: 'base', token: 'USDC', token_address: '', amount_minor: 5_000_000, new_address: true, max_fee_wei: '0', fee_paid_by: 'workspace_gas_budget', requested_by: 'agt_remy', created_at: '2026-11-25T08:00:00Z', updated_at: '2026-11-25T08:00:00Z' }

let posts: { path: string; body: string }[]
let gets: string[]

beforeEach(() => {
  posts = []
  gets = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const path = url.split('?')[0]
    if (init?.method === 'POST') {
      posts.push({ path, body: String(init.body ?? '') })
      // Lens answers a second confirm of a posted move with the same move, having moved nothing again.
      await new Promise((r) => setTimeout(r, 20))
    } else gets.push(url)
    if (path === '/api/workspace/account') return json({ account_type: 'business', money_kind: 'stablecoin' })
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [agent('agt_remy', 'Remy'), agent('agt_iris', 'Iris')] })
    if (path === '/api/money/accounts') return json({ accounts: ACCOUNTS })
    if (path === '/api/agents/approvals') return json({ approvals: [] })
    if (path === '/api/agents/agt_remy/crypto-sends') return json({ sends: [SEND] })
    if (path === '/api/agents/agt_iris/crypto-sends') return json({ sends: [] })
    if (path === '/api/agents/agt_iris/wallet-moves/quote') return json({ ...MOVE, status: 'quoted' })
    if (path === '/api/agents/agt_iris/wallet-moves/wmove_1/confirm') return json({ ...MOVE, status: 'posted' })
    if (path === '/api/wallets/capabilities') return json({ capabilities: [{ capability: 'currency_accounts', label: 'sandbox' }] })
    if (path === '/api/wallet/statement') return new Response('date,wallet,amount\n', { headers: { 'Content-Type': 'text/csv' } })
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/money/wallets']}>
        <AppMoney>
          <Routes>
            <Route path="/money/wallets" element={<WalletsScreen />} />
          </Routes>
          <SnackHost view="/money/wallets" />
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Wallets — the owner’s money in one place', () => {
  it('an agent dragged onto another moves money between them once, however many times Move is pressed', async () => {
    show()
    const agents = await screen.findByTestId('wallets-agents')
    await waitFor(() => expect(read(agents)).toContain('Iris'))
    const store = new Map<string, string>()
    const dataTransfer = { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? '', effectAllowed: '' }
    fireEvent.dragStart(screen.getByTestId('wallets-agent-macc_remy'), { dataTransfer })
    fireEvent.dragOver(screen.getByTestId('wallets-agent-macc_iris'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('wallets-agent-macc_iris'), { dataTransfer })

    const dialog = await screen.findByRole('dialog', { name: /^Move between agents/ })
    expect((within(dialog).getByLabelText('From') as HTMLSelectElement).value).toBe('macc_remy')
    expect((within(dialog).getByLabelText('To') as HTMLSelectElement).value).toBe('macc_iris')
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '25' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    const review = await within(dialog).findByTestId('move-review')
    expect(read(review)).toContain('FromRemy · USDC')
    expect(read(review)).toContain('ToIris · USDC')

    const move = within(dialog).getByRole('button', { name: /^Move/ })
    fireEvent.click(move)
    fireEvent.click(move)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Move between agents/ })).toBeNull())
    expect(posts.map((p) => p.path)).toEqual(['/api/agents/agt_iris/wallet-moves/quote', '/api/agents/agt_iris/wallet-moves/wmove_1/confirm'])
    expect(JSON.parse(posts[0].body)).toEqual({ route: 'wallet', amount_minor: 25_000_000, currency: 'USDC', from_agent_id: 'agt_remy' })
  })

  it('Move between agents opens the same move in two taps, and a crypto send waiting is counted with the way to Approvals', async () => {
    show()
    const agents = await screen.findByTestId('wallets-agents')
    fireEvent.click(await within(agents).findByRole('button', { name: 'Move between agents' }))
    expect(await screen.findByRole('dialog', { name: /^Move between agents/ })).toBeTruthy()
    const waiting = await screen.findByTestId('wallets-approvals')
    expect(read(waiting)).toContain('1 waiting for you.')
    expect(within(waiting).getByRole('link', { name: 'Open Approvals' })).toHaveAttribute('href', '/approvals')
  })

  it('every wallet’s month comes down in one file', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:statement')
    URL.revokeObjectURL = vi.fn()
    show()
    const card = await screen.findByTestId('wallets-statements')
    fireEvent.change(within(card).getByLabelText('Month'), { target: { value: '2026-10' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(gets).toContain('/api/wallet/statement?month=2026-10&format=csv'))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
  })

  // B57.218 — drawn in Pocket: the move as the fund and take panels draw a move, the download as the agent's page does.
  it('the move is drawn as the fund and take panels: the label, whose wallet it comes from and what it holds, and the three amounts', async () => {
    show()
    const agents = await screen.findByTestId('wallets-agents')
    fireEvent.click(await within(agents).findByRole('button', { name: 'Move between agents' }))
    const dialog = await screen.findByRole('dialog', { name: /^Move between agents/ })
    expect(await within(dialog).findByText('Sandbox')).toBeTruthy()
    expect(words(within(dialog).getByTestId('move-line'))).toBe('From Remy. It holds 620.00 USDC.')
    const amounts = within(dialog).getByRole('radiogroup', { name: 'Amount to move' })
    expect(within(amounts).getAllByRole('radio').map(words)).toEqual(['50.00 USDC', '100.00 USDC', '200.00 USDC'])
    expect(within(amounts).getByRole('radio', { checked: true })).toHaveTextContent('100.00 USDC')
    fireEvent.click(within(amounts).getAllByRole('radio')[0])
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('50')
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: 'macc_iris' } })
    await waitFor(() => expect(words(within(dialog).getByTestId('move-line'))).toBe('From Iris. It holds 80.00 USDC.'))
  })

  it('Statements is drawn as the agent’s page draws its statement: Download CSV and Download PDF beside the heading, then what came down', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:statement')
    URL.revokeObjectURL = vi.fn()
    show()
    const card = await screen.findByTestId('wallets-statements')
    const heading = within(card).getByRole('heading', { name: 'Statements' })
    const row = heading.parentElement as HTMLElement
    expect(within(row).getByRole('button', { name: 'Download CSV' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Download PDF' })).toBeTruthy()
    fireEvent.change(within(card).getByLabelText('Month'), { target: { value: '2026-10' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(gets).toContain('/api/wallet/statement?month=2026-10&format=pdf'))
    expect(await screen.findByText('Downloading every wallet’s statement for October 2026 as a PDF file')).toBeTruthy()
  })
})
