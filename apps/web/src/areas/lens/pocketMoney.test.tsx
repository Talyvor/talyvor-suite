import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Money, SheetFrame } from '@talyvor/ui/pocket'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppMoney, setFiat } from './money'

// B57.7 — <Money> (packages/ui) draws every figure from the app's formatter. B61.14 — an amount Lens keeps in µLXC reads
// in the person's currency alone, never LXC. The figures are written with no-break spaces; these tests write them as plain
// spaces through `text`.

const M = 1_000_000
const NBSP = /\u00a0/g

function servePeg(peg: number | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/lxc/topup-options' && peg !== null)
      return Response.json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: peg })
    if (url === '/api/fx') return Response.json({ rate_date: '2026-11-06', usd_per_eur: 1.25, gbp_per_eur: 0.8 })
    return new Response('null', { status: 404 })
  })
}

function draw(peg: number | null, node: React.ReactNode) {
  servePeg(peg)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AppMoney>{node}</AppMoney>
    </QueryClientProvider>,
  )
}

const text = (el: Element) => (el.textContent ?? '').replace(NBSP, ' ')
const figures = () => [...document.querySelectorAll('[data-money]')].map(text)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('<Money ulxc>', () => {
  it('draws dollars alone, large, and no LXC beside them (B61.14)', async () => {
    draw(0.1, <Money ulxc={16_500 * M} size="card" />)
    await waitFor(() => expect(figures()).toEqual(['$1,650.00']))
    const children = [...document.querySelector('[data-money]')!.children]
    expect(children).toHaveLength(1)
    expect(children[0]).toHaveClass('text-pocket-balance')
    expect(document.body.textContent).not.toMatch(/LXC/)
  })

  it('writes a debit with the true minus and a credit with its +', async () => {
    draw(
      0.1,
      <>
        <Money ulxc={-3400 * M} />
        <Money ulxc={900 * M} signed />
        <Money ulxc={900 * M} />
      </>,
    )
    await waitFor(() => expect(figures()).toEqual(['−$340.00', '+$90.00', '$90.00']))
  })

  it('writes under a cent as <$0.01, and no LXC beside it', async () => {
    draw(0.1, <Money ulxc={42} />)
    await waitFor(() => expect(figures()).toEqual(['<$0.01']))
  })

  it('draws a figure to the cent, whatever places Lens keeps in µLXC', async () => {
    draw(0.1, <Money ulxc={499_200_705} />)
    await waitFor(() => expect(figures()).toEqual(['$49.92']))
  })

  it('draws an ellipsis, large, while the peg is unknown: never a guessed dollar, never LXC', async () => {
    draw(null, <Money ulxc={16_500 * M} size="card" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(figures()).toEqual(['…'])
    expect(screen.getByText('…')).toHaveClass('text-pocket-balance')
  })

  it('draws the person’s chosen pounds or euros alone', async () => {
    setFiat('GBP')
    draw(0.1, <Money ulxc={1000 * M} />)
    await waitFor(() => expect(figures()).toEqual(['£64.00']))
    cleanup()
    setFiat('EUR')
    draw(0.1, <Money ulxc={1000 * M} />)
    await waitFor(() => expect(figures()).toEqual(['€80.00']))
  })
})

describe('<Money minor currency>', () => {
  it('draws an account in its own currency, USDC as a token, and no LXC', async () => {
    draw(
      0.1,
      <>
        <Money minor={40_000} currency="USD" />
        <Money minor={2400} currency="GBP" />
        <Money minor={1200} currency="EUR" />
        <Money minor={400 * M} currency="USDC" size="card-sm" />
      </>,
    )
    await waitFor(() => expect(figures()).toEqual(['$400.00', '£24.00', '€12.00', '400.00 USDC']))
    expect(screen.getByText('400')).toHaveClass('text-pocket-balance-sm')
  })
})

describe('the app’s one formatter', () => {
  it('draws every <Money> on a balance card, the sheet and a statement in dollars alone', async () => {
    // Held to Pocket's rules, as the screens that draw these are once redrawn (pocketPending.ts).
    draw(
      0.1,
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
      </div>,
    )
    await waitFor(() => expect(figures()).toEqual(['$1,650.00', '$340.00', '−$90.00']))
  })

  it('has no formatter of its own: <Money> outside the app’s provider refuses to draw', () => {
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
  'areas/lens/AgentMoneyWallet.tsx',
  'areas/lens/AlwaysAllow.tsx',
  'areas/lens/Approve.tsx',
  'areas/lens/BillingReturn.tsx',
  'areas/lens/Features.tsx',
  'areas/lens/Home.tsx',
  'areas/lens/Invoices.tsx',
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
  'areas/marketing/PricingPlans.tsx',
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
