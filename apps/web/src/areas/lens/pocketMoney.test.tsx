import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Money, SheetFrame } from '@talyvor/ui/pocket'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppMoney, setFiat } from './money'

// B57.7 — <Money> (packages/ui) draws every figure dollars first, from the app's formatter, in the order MONEY_ORDER
// names. The figures are written with no-break spaces; these tests write them as plain spaces through `text`.

const M = 1_000_000
const NBSP = / /g

function servePeg(peg: number | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/lxc/topup-options' && peg !== null)
      return Response.json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: peg })
    if (url === '/api/fx') return Response.json({ rate_date: '2026-11-06', usd_per_eur: 1.25, gbp_per_eur: 0.8 })
    return new Response('null', { status: 404 })
  })
}

type Kit = { AppMoney: typeof AppMoney; Money: typeof Money; SheetFrame: typeof SheetFrame }

function draw(peg: number | null, node: (k: Kit) => React.ReactNode, kit: Kit = { AppMoney, Money, SheetFrame }) {
  servePeg(peg)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <kit.AppMoney>{node(kit)}</kit.AppMoney>
    </QueryClientProvider>,
  )
}

const text = (el: Element) => (el.textContent ?? '').replace(NBSP, ' ')
const figures = () => [...document.querySelectorAll('[data-money]')].map(text)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.doUnmock('../../moneyOrder')
  window.localStorage.clear()
})

describe('<Money ulxc>', () => {
  it('draws dollars large and LXC small beside them, with no-break spaces', async () => {
    draw(0.1, ({ Money }) => <Money ulxc={16_500 * M} size="card" />)
    await waitFor(() => expect(figures()).toEqual(['$1,650.00 16,500 LXC']))
    const [big, small] = document.querySelector('[data-money]')!.children
    expect(big).toHaveClass('text-pocket-balance')
    expect(small.textContent).toBe('16,500 LXC')
  })

  it('writes a debit with the true minus and a credit with its +', async () => {
    draw(0.1, ({ Money }) => (
      <>
        <Money ulxc={-3400 * M} />
        <Money ulxc={900 * M} signed />
        <Money ulxc={900 * M} />
      </>
    ))
    await waitFor(() => expect(figures()).toEqual(['−$340.00 −3,400 LXC', '+$90.00 +900 LXC', '$90.00 900 LXC']))
  })

  it('writes under a cent as <$0.01 with its exact LXC beside it', async () => {
    draw(0.1, ({ Money }) => <Money ulxc={42} />)
    await waitFor(() => expect(figures()).toEqual(['<$0.01 0.000042 LXC']))
  })

  it('draws LXC alone, large, while the peg is unknown', async () => {
    draw(null, ({ Money }) => <Money ulxc={16_500 * M} size="card" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(figures()).toEqual(['16,500 LXC'])
    expect(screen.getByText('16,500')).toHaveClass('text-pocket-balance')
  })

  it('draws the person’s chosen pounds or euros first', async () => {
    setFiat('GBP')
    draw(0.1, ({ Money }) => <Money ulxc={1000 * M} />)
    await waitFor(() => expect(figures()).toEqual(['£64.00 1,000 LXC']))
    cleanup()
    setFiat('EUR')
    draw(0.1, ({ Money }) => <Money ulxc={1000 * M} />)
    await waitFor(() => expect(figures()).toEqual(['€80.00 1,000 LXC']))
  })
})

describe('<Money minor currency>', () => {
  it('draws an account in its own currency, USDC as a token, and no LXC', async () => {
    draw(0.1, ({ Money }) => (
      <>
        <Money minor={40_000} currency="USD" />
        <Money minor={2400} currency="GBP" />
        <Money minor={1200} currency="EUR" />
        <Money minor={400 * M} currency="USDC" size="card-sm" />
      </>
    ))
    await waitFor(() => expect(figures()).toEqual(['$400.00', '£24.00', '€12.00', '400.00 USDC']))
    expect(screen.getByText('400')).toHaveClass('text-pocket-balance-sm')
  })
})

describe('one switch', () => {
  it('flips every <Money> on a balance card, the sheet and a statement with MONEY_ORDER', async () => {
    // Held to Pocket's rules, as the screens that draw these are once redrawn (pocketPending.ts).
    const page = ({ Money, SheetFrame }: Kit) => (
      <div data-design="pocket">
        <Money ulxc={16_500 * M} size="card" />
        <SheetFrame head="Research wants to pay" amount={<Money ulxc={3400 * M} size="sheet" />} />
        <table>
          <tbody>
            <tr>
              <td>
                <Money ulxc={-900 * M} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
    draw(0.1, page)
    await waitFor(() => expect(figures()).toEqual(['$1,650.00 16,500 LXC', '$340.00 3,400 LXC', '−$90.00 −900 LXC']))
    cleanup()
    vi.restoreAllMocks()

    vi.resetModules()
    vi.doMock('../../moneyOrder', () => ({ MONEY_ORDER: 'lxc-first' }))
    const flipped = await import('./money')
    const pocket = await import('@talyvor/ui/pocket')
    draw(0.1, page, { AppMoney: flipped.AppMoney, Money: pocket.Money, SheetFrame: pocket.SheetFrame })
    await waitFor(() => expect(figures()).toEqual(['16,500 LXC $1,650.00', '3,400 LXC $340.00', '−900 LXC −$90.00']))
  })

  it('has no order of its own: <Money> outside the app’s provider refuses to draw', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Money ulxc={M} />)).toThrow(/MoneyProvider/)
  })
})

// B57.7 — the files that still print money without <Money>. Each Pocket item that redraws a screen moves its figures
// into <Money> and takes its files off this list; B57.88 needs it empty. A file that starts printing money another way
// fails here, and so does a file that stopped (take it off the list).
const PRINTS_MONEY = /\bformatULXC\(|\bfiatText\(|\bformatMinor\(|\bcurrencyText\(|\bformatUSD\(|\blxcText\(|\buseLxcText\(|<Lxc\b|style: 'currency'/
const FORMATTERS = new Set(['areas/lens/money.tsx', 'areas/lens/agentBankApi.ts'])
const NOT_YET = [
  'areas/chat/AgentTask.tsx',
  'areas/chat/AlertNotices.tsx',
  'areas/chat/AllowanceMeter.tsx',
  'areas/chat/ApprovalCards.tsx',
  'areas/chat/Chat.tsx',
  'areas/chat/ForecastQuestion.tsx',
  'areas/chat/LaunchAgent.tsx',
  'areas/chat/ListingChoice.tsx',
  'areas/chat/LiveStatement.tsx',
  'areas/chat/MoneyCards.tsx',
  'areas/chat/PayCommand.tsx',
  'areas/chat/PaymentCards.tsx',
  'areas/chat/PlanQuestion.tsx',
  'areas/chat/RecentCalls.tsx',
  'areas/chat/RuleCommand.tsx',
  'areas/chat/Savings.tsx',
  'areas/chat/ScheduledPrompt.tsx',
  'areas/chat/WalletButtons.tsx',
  'areas/lens/AccountStatement.tsx',
  'areas/lens/AgentBank.tsx',
  'areas/lens/AgentCardPanel.tsx',
  'areas/lens/AgentCredential.tsx',
  'areas/lens/AgentMoneyWallet.tsx',
  'areas/lens/AlwaysAllow.tsx',
  'areas/lens/Approve.tsx',
  'areas/lens/BillingReturn.tsx',
  'areas/lens/Budgets.tsx',
  'areas/lens/Features.tsx',
  'areas/lens/Home.tsx',
  'areas/lens/Invoices.tsx',
  'areas/lens/MonthPlan.tsx',
  'areas/lens/Onboarding.tsx',
  'areas/lens/OperatorCompliance.tsx',
  'areas/lens/OperatorTax.tsx',
  'areas/lens/OperatorWorkspaces.tsx',
  'areas/lens/Overview.tsx',
  'areas/lens/Pay.tsx',
  'areas/lens/Plans.tsx',
  'areas/lens/RecurringPlan.tsx',
  'areas/lens/SafeToSpend.tsx',
  'areas/lens/Scan.tsx',
  'areas/lens/Spend.tsx',
  'areas/lens/Spending.tsx',
  'areas/lens/Subscriptions.tsx',
  'areas/lens/TopUp.tsx',
  'areas/lens/WalletHoldings.tsx',
  'areas/lens/WalletMoney.tsx',
  'areas/lens/format.ts',
  'areas/lens/rulePickers.tsx',
  'areas/lens/topupApi.ts',
  'areas/marketing/PriceCard.tsx',
  'areas/marketing/pricingApi.ts',
  'areas/marketplace/EarningsList.tsx',
  'areas/marketplace/Licences.tsx',
  'areas/marketplace/ListingOffers.tsx',
  'areas/marketplace/Marketplace.tsx',
  'areas/marketplace/ParkedUses.tsx',
  'areas/marketplace/Review.tsx',
  'areas/marketplace/SellerStatements.tsx',
  'areas/marketplace/UseListing.tsx',
  'areas/marketplace/parts.tsx',
  'areas/pay/PayInvoice.tsx',
  'areas/rooms/Room.tsx',
  'areas/rooms/RoomSettings.tsx',
  'components/CommandPalette.tsx',
  'figureAudit.ts',
]

describe('money printed without <Money>', () => {
  it('is only in the files Pocket has not redrawn yet', () => {
    const root = resolve(__dirname, '../..')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    const printing = walk(root)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => relative(root, f))
      .filter((f) => !FORMATTERS.has(f) && PRINTS_MONEY.test(readFileSync(join(root, f), 'utf8')))
      .sort()
    expect(printing).toEqual(NOT_YET)
  })
})
