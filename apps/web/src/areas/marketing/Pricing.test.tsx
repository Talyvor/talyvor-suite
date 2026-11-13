import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pricing } from './Pricing'
import { pressEverything } from '../../test/pressEverything'
import { BUILDING } from '../../labels/StatusLabel'
import { CREDIT_FOR_AGENTS, MONEY_FEATURES } from '../../labels/capabilities'

// The page renders BARE — no router, no query client — like Landing. What it prints is what
// GET /api/pricing served, so each test serves a peg this repo never writes down (0.2, not the
// production 0.10) and asserts the page followed the server rather than a constant.

function serve(body: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) !== '/api/pricing') return new Response('null', { status: 404 })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

afterEach(() => vi.restoreAllMocks())

/** A price card no deployment states: every figure differs from Nicolai's, so only a page that reads the
 *  server prints them. */
const CHANGED_CARD = {
  usd_per_lxc: 0.2,
  min_usd_cents: 1000,
  max_usd_cents: 1_000_000,
  preset_usd_cents: [1000],
  plans: [
    { id: 'plus', usd_cents: 2100, included_ulxc: 180_000_000 },
    { id: 'pro', usd_cents: 11000, included_ulxc: 1_090_000_000 },
    { id: 'max', usd_cents: 21000, included_ulxc: 2_000_000_000 },
  ],
  company_plans: [
    { id: 'team', usd_cents: 5900 },
    { id: 'business', usd_cents: 34900 },
  ],
  byok_add_on_usd_cents: 20900,
  enterprise_from_usd_cents: 300000,
  card_payments: 'live',
  plan_gates: {
    order: ['free', 'team', 'business', 'enterprise'],
    plans: {
      free: { agents: 3, seats: 1, own_provider_keys: 'none', live_money: false, slack_teams_approvals: false, sso: false, audit_export: false, edge: false },
      team: { agents: 40, seats: 6, own_provider_keys: 'add_on', live_money: true, slack_teams_approvals: true, sso: false, audit_export: false, edge: false },
      business: { agents: -1, seats: 30, own_provider_keys: 'included', live_money: true, slack_teams_approvals: true, sso: true, audit_export: false, edge: false },
      enterprise: { agents: -1, seats: -1, own_provider_keys: 'included', live_money: true, slack_teams_approvals: true, sso: true, audit_export: true, edge: true },
    },
  },
  fees: {
    market_take_bps: 1500,
    services_take_bps: 400,
    compute_take_bps: 400,
    lending_fee_bps: 150,
    platform_fee_bps: { free: 600, team: 325, business: 150, enterprise: 100 },
    fx_margin_bps: { free: 0, team: 60, business: 30, enterprise: 15 },
    intl_payment_fee_minor: { EUR: 500, GBP: 400, USD: 800 },
    merchant_fee_bps: 80,
    merchant_a2a_fee_bps: 110,
  },
}

describe('/pricing', () => {
  // B57.61: the reference's headline, its one line and its one action.
  it('opens with the headline, the served rate in one line and Create your workspace', async () => {
    serve(CHANGED_CARD)
    render(<Pricing />)
    await screen.findByTestId('company-plan-team')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Credit for your agents. A plan for your people.')
    // $0.20 is a peg this repo never writes: $10 buys 50 LXC only on a page that read it.
    expect(screen.getByText(/^Every plan has wallets/)).toHaveTextContent(
      'Every plan has wallets, rules, approvals and statements. 1 LXC is $0.20, so $10 buys 50 LXC.',
    )
    expect(screen.getByRole('link', { name: 'Create your workspace' })).toHaveAttribute('href', '/signup')
  })

  it('prints no rate when the deployment will not confirm one', async () => {
    const { usd_per_lxc: _peg, ...unpegged } = CHANGED_CARD
    serve(unpegged)
    render(<Pricing />)
    await screen.findByTestId('company-plan-team')
    expect(screen.getByText(/^Every plan has wallets/)).toHaveTextContent(/^Every plan has wallets, rules, approvals and statements\.$/)
    expect(screen.queryByText(/LXC is/)).not.toBeInTheDocument()
  })

  // B57.61: the served-rate card, the top-up amounts and the monthly-billing line are left out.
  it('draws no rate card, no top-up amounts and no monthly-billing line', async () => {
    serve(CHANGED_CARD)
    const { container } = render(<Pricing />)
    await screen.findByTestId('company-plan-team')
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/one credit|top up any amount|buys 50 LXC.*buys|billed monthly|a paid plan, if you choose one|GET \/api\/pricing/i)
    expect(screen.queryByRole('heading', { name: /top up the workspace/i })).not.toBeInTheDocument()
  })

  // B32.14: the approved price card, every figure as GET /api/pricing served it. Each test serves figures this
  // repo never writes down, so a page reading a constant instead of the server fails. B59.5: no chat plans, Edge row,
  // Marketplace, compute or loan fee (LAUNCH-PACK.md section 2).
  it('prints the company plans and fees exactly as served, and the tax line under them', async () => {
    serve(CHANGED_CARD)
    render(<Pricing />)
    const team = await screen.findByTestId('company-plan-team')

    expect(within(team).getByTestId('price-team')).toHaveTextContent('$59')
    expect(team).toHaveTextContent('Agents40')
    expect(team).toHaveTextContent('Seats6')
    expect(team).toHaveTextContent('Platform fee on AI spend3.25%')
    expect(team).toHaveTextContent('Own provider keys$209 add-on')
    expect(team).toHaveTextContent('Live moneyIncluded')
    expect(team).toHaveTextContent('FX margin over the reference rate0.6%')
    // A Building chip sits beside its row's label, before what the plan gives (building.json's, not Lens's).
    expect(team).toHaveTextContent('Slack and Teams approvalsBuildingIncluded')
    expect(team).toHaveTextContent('Single sign-onNot included')
    expect(team).toHaveTextContent('Audit exportNot included')
    // B56.2: each gate on its own row, from its own flag. Business serves sign-on without audit export.
    const business = screen.getByTestId('company-plan-business')
    expect(business).toHaveTextContent('Single sign-onBuildingIncluded')
    expect(business).toHaveTextContent('Audit exportNot included')
    expect(screen.queryByText(/SSO and audit export/)).not.toBeInTheDocument()

    const free = screen.getByTestId('company-plan-free')
    expect(within(free).getByTestId('price-free')).toHaveTextContent('$0')
    expect(free).not.toHaveTextContent('a month')
    expect(free).toHaveTextContent('Live moneyNot included')
    expect(free).toHaveTextContent('FX margin over the reference rateNot offered')
    expect(free).toHaveTextContent('Own provider keysNot included')
    expect(within(business).getByTestId('price-business')).toHaveTextContent('$349')
    const enterprise = screen.getByTestId('company-plan-enterprise')
    expect(enterprise).toHaveTextContent('From$3,000a month')
    expect(enterprise).toHaveTextContent('Platform fee on AI spendAgreed')
    expect(enterprise).toHaveTextContent('AgentsUnlimited')
    expect(within(enterprise).getByRole('link', { name: 'Talk to us' })).toHaveAttribute('href', 'mailto:hello@talyvor.com')

    // B56.2: what a request costs, each plan's served platform fee on its own line.
    expect(screen.getByTestId('platform-fee-line')).toHaveTextContent('Free6%Team3.25%Business1.5%EnterpriseAgreed')

    const fees = screen.getByTestId('fees-any-plan')
    // Services says what it is taken on.
    expect(fees).toHaveTextContent('Services4% of a payment to another company’s agent')
    expect(fees).not.toHaveTextContent(/Services and compute|Compute|Sellers|Loans|International|Agent cards|Accepting payments|FX margin/)
    expect(screen.getByRole('heading', { name: 'Fees on money features' })).toBeInTheDocument()
    const money = screen.getByTestId('fees-money-features')
    expect(money).not.toHaveTextContent(/Loans/)
    expect(money).toHaveTextContent('£4, €5 or $8 plus the partner’s cost')
    expect(money).toHaveTextContent('Agent cardsFree to issue')
    expect(money).toHaveTextContent('Accepting paymentsBuilding0.8% plus card processing, or 1.1% from an account')
    expect(money).toHaveTextContent('FX margin over the reference rateTeam 0.6% · Business 0.3% · Enterprise agreed')
    expect(screen.getByTestId('tax-line')).toHaveTextContent(
      'Prices are in US dollars. Where Talyvor must charge VAT or sales tax, it is added at checkout and shown before you pay.',
    )
    expect(screen.queryByRole('heading', { name: /one bill a month|chat plans/i })).not.toBeInTheDocument()
    expect(enterprise).not.toHaveTextContent(/Edge/)
  })

  it('says an empty wallet refuses the next call', async () => {
    serve(CHANGED_CARD)
    render(<Pricing />)
    await screen.findByTestId('company-plan-team')
    expect(screen.getByText(/its next call is refused/)).toHaveTextContent(
      'Each agent spends LXC from its own wallet. When its wallet is empty, its next call is refused rather than billed to you.',
    )
  })

  it('prints no plan price, gate or fee the server did not state', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    render(<Pricing />)
    expect(await screen.findByText(/what each plan includes could not be read/i)).toBeInTheDocument()
    expect(screen.getByText(/the fees could not be read/i)).toBeInTheDocument()
    expect(screen.queryByTestId('platform-fee-line')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fees-money-features')).not.toBeInTheDocument()
    // And the tax line is still said.
    expect(screen.getByTestId('tax-line')).toBeInTheDocument()
  })

  // B57.61: Pocket's look — Team highlighted on white with the ink ring, the rest on cloud, prices in tabular figures.
  it('highlights Team, puts the other plans on cloud and holds the page to Pocket’s rules', async () => {
    serve(CHANGED_CARD)
    const { container } = render(<Pricing />)
    await screen.findByTestId('company-plan-team')
    expect(container.firstElementChild).toHaveAttribute('data-design', 'pocket')
    const highlighted = container.querySelectorAll('[data-highlighted="true"]')
    expect([...highlighted].map((c) => c.getAttribute('data-testid'))).toEqual(['company-plan-team'])
    expect(screen.getByTestId('company-plan-team')).toHaveClass('bg-page', 'shadow-pocket', 'ring-ink')
    for (const id of ['free', 'business', 'enterprise']) expect(screen.getByTestId(`company-plan-${id}`)).toHaveClass('bg-cloud')
    expect(screen.getByTestId('price-team')).toHaveClass('font-figure')
    // One ink action on the page: Create your workspace. Every plan's button is outlined.
    expect([...container.querySelectorAll('a.bg-primary')].map((a) => a.textContent)).toEqual(['Create your workspace'])
  })

  // B51.3: while a card cannot be charged, every price and what each plan includes, and no card line or Choose button —
  // the page's one action is Create your workspace.
  it.each(['test', 'off', undefined])('offers no card while card_payments is %s', async (cardPayments) => {
    serve({ ...CHANGED_CARD, card_payments: cardPayments })
    const { container } = render(<Pricing />)
    await screen.findByTestId('company-plan-team')

    expect(screen.getByTestId('price-team')).toHaveTextContent('$59')
    expect(container.textContent ?? '').not.toMatch(/on your card/i)
    const main = container.querySelector('main')!
    expect(within(main).getAllByRole('link', { name: /choose|start free|talk to us|create your workspace/i }).map((a) => a.textContent)).toEqual([
      'Create your workspace',
    ])
  })

  it('every control on the page does something', async () => {
    const report = await pressEverything('/pricing', { '/api/pricing': { ...CHANGED_CARD, labels: { buy_marketplace_listings: 'sandbox' } } })
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(8)
  })
})

// B56.10 — every money section and fee row follows the labels /api/pricing serves, and Building sits only on a switch Lens
// does not enforce or a fee it does not charge, and only from building.json.
describe('/pricing labels', () => {
  const live = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 'live']))
  const LABELLED = {
    ...CHANGED_CARD,
    labels: { ...live(CREDIT_FOR_AGENTS), ...live(MONEY_FEATURES), buy_marketplace_listings: 'live', rent_and_subscribe_listings: 'sandbox', pay_another_owner: 'sandbox', loans_between_companies: 'sandbox', agent_card: 'sandbox' },
    plan_gates: { ...CHANGED_CARD.plan_gates, built: { slack_teams_approvals: false, sso: true, edge: false, audit_export: true } },
    fees: { ...CHANGED_CARD.fees, charged: { fx_margin_bps: false, lending_fee_bps: true, merchant_fee_bps: false, merchant_a2a_fee_bps: false } },
  }
  const chips = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-status-key]')].map((c) => `${c.getAttribute('data-status-key')}=${c.textContent}`)
  // B57.61: a row's chips sit in its dt beside the label, as the reference draws them.
  const row = (el: HTMLElement, label: string) => within(el).getByText(label, { selector: 'dt > span' }).closest('dt')!.parentElement!

  it('draws each section and row as Lens labels it', async () => {
    serve(LABELLED)
    render(<Pricing />)
    const team = await screen.findByTestId('company-plan-team')
    expect(chips(screen.getByRole('heading', { name: /^credit for agents/i }))).toEqual([`${CREDIT_FOR_AGENTS.join(' ')}=Live`])
    expect(chips(row(team, 'Live money'))).toEqual([`${MONEY_FEATURES.join(' ')}=Live`])
    expect(chips(row(screen.getByTestId('company-plan-free'), 'Live money'))).toEqual([])
    const anyPlan = screen.getByTestId('fees-any-plan')
    expect(chips(row(anyPlan, 'Services'))).toEqual(['pay_another_owner=Sandbox'])
    const money = screen.getByTestId('fees-money-features')
    expect(chips(row(money, 'International payments'))).toEqual(['payments_out=Live'])
    expect(chips(row(money, 'Agent cards'))).toEqual(['agent_card=Sandbox'])
  })

  it('carries Building from building.json on what Lens does not enforce or charge yet, and nowhere else', async () => {
    serve(LABELLED)
    render(<Pricing />)
    const team = await screen.findByTestId('company-plan-team')
    const business = screen.getByTestId('company-plan-business')
    const building = (el: HTMLElement) =>
      [...el.querySelectorAll('[data-status-key][data-status-label="building"]')].map((c) => c.getAttribute('data-status-key'))
    expect(building(row(team, 'Slack and Teams approvals'))).toEqual(['slack_teams_approvals'])
    expect(building(row(screen.getByTestId('company-plan-free'), 'Slack and Teams approvals'))).toEqual([]) // "—"
    expect(building(row(business, 'Single sign-on'))).toEqual([]) // Lens says built
    expect(building(row(business, 'Audit export'))).toEqual([])
    expect(building(row(team, 'FX margin over the reference rate'))).toEqual([]) // B17.456: currency conversion shipped (B56.23)
    const money = screen.getByTestId('fees-money-features')
    expect(building(row(money, 'Accepting payments'))).toEqual(['merchant_fees'])
    for (const el of document.querySelectorAll('[data-status-key][data-status-label="building"]'))
      expect(BUILDING.some((e) => e.key === el.getAttribute('data-status-key'))).toBe(true)
    expect(screen.getByTestId('labels-meaning').textContent).toContain('In our build queue. Not shipped yet.')
  })

  it('draws no Live or Sandbox while Lens serves no labels', async () => {
    serve(CHANGED_CARD)
    const { container } = render(<Pricing />)
    await screen.findByTestId('company-plan-team')
    expect(container.querySelectorAll('[data-status-key][data-status-label="live"], [data-status-key][data-status-label="sandbox"]')).toHaveLength(0)
  })
})
