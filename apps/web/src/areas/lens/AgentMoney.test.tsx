import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../App'
import { areaSource } from '../../lib/workspaceAreas'
import { populatedBff, settleQueries } from '../../populatedBff'
import { pressAll } from '../../test/pressEverything'
import { AgentMoneySection } from './AgentMoney'
import type { Agent } from './agentBankApi'
import { AppMoney } from './money'

// B57.21 — an agent's money features on its page (Pocket w-agent-research's Money card): one row per feature, its state
// in the line under it, each opening its own panel; lending and the simulated portfolios only where the workspace has
// credit and trading (B59.2). What each panel posts is WalletMoney.test.tsx's, WalletHoldings.test.tsx's and
// AgentMoneyWallet.test.tsx's.

const AGENT = { id: 'agt_research', name: 'Researcher', balance_ulxc: 10_000_000, spent_ulxc: 1_250_000, keys: ['key_1'], created_at: '2026-09-27T09:00:00Z' } as unknown as Agent

const ROWS = [
  ['address', 'Its address', 'Researcher’s address'],
  ['send', 'Send or request', 'Send or request'],
  ['requests', 'Requests', 'Requests'],
  ['transfers', 'Transfers', 'Transfers'],
  ['recurring', 'Recurring transfer', 'Recurring transfer'],
  ['pots', 'Pots', 'Pots'],
  ['escrow', 'Escrow', 'Escrow'],
  ['cash-out', 'Cash out', 'Cash out'],
  ['loans', 'Loans', 'Loans'],
  ['credit', 'Credit line', 'Credit line'],
  ['wallet', 'Its wallet', 'Researcher’s wallet'],
  ['investing', 'Investing, simulated', 'Investing, simulated'],
] as const

async function mount() {
  queryClient.clear()
  render(
    <QueryClientProvider client={queryClient}>
      <AppMoney>
        <BrowserRouter>
          <AgentMoneySection agent={AGENT} />
        </BrowserRouter>
      </AppMoney>
    </QueryClientProvider>,
  )
  await settleQueries(queryClient, waitFor)
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('An agent’s money features, on its page (B57.21)', () => {
  it('draws one row per feature, each saying where it stands and opening its own panel', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    await mount()
    const card = screen.getByTestId('agent-page-money')
    expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual(ROWS.map(([, title]) => title))
    expect(within(card).getByTestId('money-row-address').parentElement?.textContent).toContain('Anyone on Talyvor can send Researcher credits at its wallet ID or @handle')
    for (const [row, , title] of ROWS) {
      fireEvent.click(within(card).getByTestId(`money-row-${row}`))
      expect(await screen.findByRole('dialog', { name: title })).toBeInTheDocument()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('has no Loans or Investing row for a workspace without credit and trading', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    const { read, initial } = areaSource
    areaSource.read = () => Promise.resolve([])
    areaSource.initial = []
    try {
      await mount()
      expect(screen.getByTestId('money-row-pots')).toBeInTheDocument()
      expect(screen.queryByTestId('money-row-loans')).toBeNull()
      expect(screen.queryByTestId('money-row-investing')).toBeNull()
    } finally {
      areaSource.read = read
      areaSource.initial = initial
    }
  })

  it.each(ROWS.map(([row, , title]) => [title, row] as const))('every control on its %s panel does something', async (_title, row) => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    const report = await pressAll(
      async () => {
        await mount()
        fireEvent.click(screen.getByTestId(`money-row-${row}`))
        await screen.findByRole('dialog')
        await settleQueries(queryClient, waitFor)
      },
      () => asked.length,
    )
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead).toEqual([])
  }, 300_000)
})
