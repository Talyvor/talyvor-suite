import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pricing } from './Pricing'
import { pressEverything } from '../../test/pressEverything'
import { BUILDING } from '../../labels/StatusLabel'
import { MONEY_FEATURES } from '../../labels/capabilities'

// The page renders BARE — no router, no query client — like Landing. What it prints is what
// GET /api/pricing served, so each test serves figures this repo never writes down and asserts the page followed the
// server rather than a constant.

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
 *  server prints them. B61.59: the plans are Lens's two ladders (GET /v1/public/plans). */
const CHANGED_CARD = {
  min_usd_cents: 1000,
  max_usd_cents: 1_000_000,
  preset_usd_cents: [1000],
  card_payments: 'live',
  ladders: {
    currencies: ['GBP', 'EUR', 'USD'],
    stablecoin_priced_in: 'USD',
    personal: [
      { id: 'personal_solo', name: 'Solo', price_minor: { GBP: 0, EUR: 0, USD: 0 }, agents: 4, people: 1 },
      { id: 'personal_crew', name: 'Crew', price_minor: { GBP: 412, EUR: 433, USD: 455 }, agents: 11, people: 1 },
      { id: 'personal_fleet', name: 'Fleet', price_minor: { GBP: 812, EUR: 913, USD: 1014 }, agents: 27, people: 1 },
    ],
    business: [
      { id: 'business_studio', name: 'Studio', price_minor: { GBP: 1100, EUR: 1100, USD: 1100 }, agents: 3, people: 1 },
      { id: 'business_company', name: 'Company', price_minor: { GBP: 3600, EUR: 3600, USD: 3600 }, agents: 26, people: 6 },
      { id: 'business_group', name: 'Group', price_minor: { GBP: 12600, EUR: 12600, USD: 12600 }, agents: -1, people: 24 },
      { id: 'business_custom', name: 'Custom', price_minor: null, by_contract: true, agents: -1, people: -1 },
    ],
  },
  fees: {
    market_take_bps: 1500,
    services_take_bps: 400,
    compute_take_bps: 400,
    lending_fee_bps: 150,
    platform_fee_bps: { personal_solo: 600 },
    fx_margin_bps: { personal_solo: 110, personal_crew: 45, personal_fleet: 0, business_studio: 70, business_company: 70, business_group: 70 },
    intl_payment_fee_minor: { EUR: 500, GBP: 400, USD: 800 },
    merchant_fee_bps: 80,
    merchant_a2a_fee_bps: 110,
  },
}

describe('/pricing', () => {
  // B57.61: the reference's headline, its one line and its one action. B61.59: no LXC.
  it('opens with the headline, its line and Create your workspace, and says no LXC', async () => {
    serve(CHANGED_CARD)
    const { container } = render(<Pricing />)
    await screen.findByTestId('ladder-plan-personal_crew')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Credit for your agents. A plan for your people.')
    expect(screen.getByText(/^Every plan has wallets/)).toHaveTextContent(/^Every plan has wallets, rules, approvals and statements\.$/)
    expect(screen.getByRole('link', { name: 'Create your workspace' })).toHaveAttribute('href', '/signup')
    expect(container.textContent).not.toMatch(/LXC/)
  })

  // B61.59: both ladders, every figure as GET /api/pricing served it, and no 5 Oct plan. Each figure differs from Lens's
  // defaults, so a page reading a constant instead of the server fails. B59.5: no chat plans, Edge row, Marketplace,
  // compute or loan fee (LAUNCH-PACK.md section 2).
  it('prints both ladders and the fees exactly as served, and the tax line under them', async () => {
    serve(CHANGED_CARD)
    const { container } = render(<Pricing />)
    const personal = await screen.findByTestId('ladder-personal')
    const business = screen.getByTestId('ladder-business')
    const names = (el: HTMLElement) => within(el).getAllByTestId(/^ladder-plan-/).map((c) => c.querySelector('p')?.textContent)
    expect(names(personal)).toEqual(['Solo', 'Crew', 'Fleet'])
    expect(names(business)).toEqual(['Studio', 'Company', 'Group', 'Custom'])

    const crew = screen.getByTestId('ladder-plan-personal_crew')
    expect(within(crew).getByTestId('price-personal_crew')).toHaveTextContent('£4.12 · €4.33 · $4.55')
    expect(crew).toHaveTextContent('Agents11')
    expect(crew).toHaveTextContent('People1')
    expect(crew).toHaveTextContent('Exchange fee0.45%')
    expect(screen.getByTestId('ladder-plan-personal_fleet')).toHaveTextContent('Exchange feeNone')
    const group = screen.getByTestId('ladder-plan-business_group')
    expect(within(group).getByTestId('price-business_group')).toHaveTextContent('£126 · €126 · $126')
    expect(group).toHaveTextContent('AgentsUnlimited')
    expect(group).toHaveTextContent('People24')
    const custom = screen.getByTestId('ladder-plan-business_custom')
    expect(custom).toHaveTextContent('By contract')
    expect(custom).not.toHaveTextContent(/Exchange fee/)
    expect(within(custom).getByRole('link', { name: 'Custom: talk to us' })).toHaveAttribute('href', 'mailto:hello@talyvor.com')
    expect(container.textContent).not.toMatch(/\b(Free|Team|Business|Enterprise)\b/)

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
    expect(money).toHaveTextContent('FX margin over the reference rateSolo 1.1% · Crew 0.45% · Fleet 0% · Studio 0.7% · Company 0.7% · Group 0.7%')
    expect(screen.getByTestId('tax-line')).toHaveTextContent(
      'Each plan is paid in your account’s currency. Where Talyvor must charge VAT or sales tax, it is added at checkout and shown before you pay.',
    )
    expect(screen.queryByRole('heading', { name: /one bill a month|chat plans|credit for agents/i })).not.toBeInTheDocument()
    expect(business).not.toHaveTextContent(/Edge|platform fee/i)
  })

  it('prints no plan price or fee the server did not state', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    render(<Pricing />)
    expect(await screen.findByText(/the plans could not be read/i)).toBeInTheDocument()
    expect(screen.getByText(/the fees could not be read/i)).toBeInTheDocument()
    expect(screen.queryByTestId('fees-money-features')).not.toBeInTheDocument()
    // And the tax line is still said.
    expect(screen.getByTestId('tax-line')).toBeInTheDocument()
  })

  // B57.61: Pocket's look — plans on cloud, prices in tabular figures, one ink action.
  it.each(['live', 'test', 'off', undefined])('holds the page to Pocket’s rules, with one action, while card_payments is %s', async (cardPayments) => {
    serve({ ...CHANGED_CARD, card_payments: cardPayments })
    const { container } = render(<Pricing />)
    await screen.findByTestId('ladder-plan-personal_crew')
    expect(container.firstElementChild).toHaveAttribute('data-design', 'pocket')
    for (const card of screen.getAllByTestId(/^ladder-plan-/)) expect(card).toHaveClass('bg-cloud')
    expect(screen.getByTestId('price-personal_crew')).toHaveClass('font-figure')
    expect([...container.querySelectorAll('a.bg-primary')].map((a) => a.textContent)).toEqual(['Create your workspace'])
    expect(container.textContent ?? '').not.toMatch(/on your card/i)
    const main = container.querySelector('main')!
    expect(within(main).getAllByRole('link', { name: /choose|start free|talk to us|create your workspace/i }).map((a) => a.textContent)).toEqual([
      'Create your workspace',
      'Custom: talk to us',
    ])
  })

  it('every control on the page does something', async () => {
    const report = await pressEverything('/pricing', { '/api/pricing': { ...CHANGED_CARD, labels: { buy_marketplace_listings: 'sandbox' } } })
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(8)
  })
})

// B56.10 — every money section and fee row follows the labels /api/pricing serves, and Building sits only on a fee Lens
// does not charge, and only from building.json.
describe('/pricing labels', () => {
  const live = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 'live']))
  const LABELLED = {
    ...CHANGED_CARD,
    labels: { ...live(MONEY_FEATURES), fx: 'live', buy_marketplace_listings: 'live', pay_another_owner: 'sandbox', agent_card: 'sandbox' },
    fees: { ...CHANGED_CARD.fees, charged: { fx_margin_bps: false, lending_fee_bps: true, merchant_fee_bps: false, merchant_a2a_fee_bps: false } },
  }
  const chips = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-status-key]')].map((c) => `${c.getAttribute('data-status-key')}=${c.textContent}`)
  // B57.61: a row's chips sit in its dt beside the label, as the reference draws them.
  const row = (el: HTMLElement, label: string) => within(el).getByText(label, { selector: 'dt > span' }).closest('dt')!.parentElement!

  it('draws each row as Lens labels it', async () => {
    serve(LABELLED)
    render(<Pricing />)
    const crew = await screen.findByTestId('ladder-plan-personal_crew')
    expect(chips(row(crew, 'Exchange fee'))).toEqual(['fx=Live'])
    const anyPlan = screen.getByTestId('fees-any-plan')
    expect(chips(row(anyPlan, 'Services'))).toEqual(['pay_another_owner=Sandbox'])
    const money = screen.getByTestId('fees-money-features')
    expect(chips(row(money, 'International payments'))).toEqual(['payments_out=Live'])
    expect(chips(row(money, 'Agent cards'))).toEqual(['agent_card=Sandbox'])
  })

  it('carries Building from building.json on what Lens does not charge yet, and nowhere else', async () => {
    serve(LABELLED)
    render(<Pricing />)
    await screen.findByTestId('ladder-plan-personal_crew')
    const building = (el: HTMLElement) =>
      [...el.querySelectorAll('[data-status-key][data-status-label="building"]')].map((c) => c.getAttribute('data-status-key'))
    const money = screen.getByTestId('fees-money-features')
    expect(building(row(money, 'Accepting payments'))).toEqual(['merchant_fees'])
    for (const el of document.querySelectorAll('[data-status-key][data-status-label="building"]'))
      expect(BUILDING.some((e) => e.key === el.getAttribute('data-status-key'))).toBe(true)
    expect(screen.getByTestId('labels-meaning').textContent).toContain('In our build queue. Not shipped yet.')
  })

  it('draws no Live or Sandbox while Lens serves no labels', async () => {
    serve(CHANGED_CARD)
    const { container } = render(<Pricing />)
    await screen.findByTestId('ladder-plan-personal_crew')
    expect(container.querySelectorAll('[data-status-key][data-status-label="live"], [data-status-key][data-status-label="sandbox"]')).toHaveLength(0)
  })
})
