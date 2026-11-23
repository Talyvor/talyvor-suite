import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppMoney, FIAT_KEY } from './money'
import { PLAN_SANDBOX_LINE, PlanSettings } from './PlanSettings'

// B61.59 — Settings, Plan: the account's plan and the ladder of its own type, every figure Lens's. The ladders are
// GET /api/pricing's (Lens's GET /v1/public/plans) and the plan GET /api/plan's; the figures below are NOT Lens's
// defaults on purpose, so a figure typed into the page could not pass for one read from Lens.

const LADDERS = {
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
}

const FEES = { fx_margin_bps: { personal_solo: 110, personal_crew: 45, personal_fleet: 0, business_studio: 60 } }

const PERSONAL = {
  plan: 'personal_crew',
  name: 'Crew',
  account_type: 'personal',
  on_contract: false,
  price_minor: { GBP: 412, EUR: 433, USD: 455 },
  agents: 11,
  agents_used: 5,
  seats: 1,
}
const BUSINESS = {
  plan: 'business_company',
  name: 'Company',
  account_type: 'business',
  on_contract: false,
  price_minor: { GBP: 3600, EUR: 3600, USD: 3600 },
  agents: 26,
  agents_used: 2,
  seats: 6,
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockBff(plan: unknown, change?: { status: number; body: unknown }) {
  const puts: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/plan' && init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)))
      return json(change?.body ?? {}, change?.status ?? 200)
    }
    if (url === '/api/plan') return json(plan)
    if (url === '/api/pricing')
      return json({ min_usd_cents: 0, max_usd_cents: 0, preset_usd_cents: [], ladders: LADDERS, fees: FEES, card_payments: 'test' })
    if (url === '/api/wallets/capabilities')
      return json({ capabilities: [{ capability: 'spend_on_talyvor', name: 'Spending on Talyvor', class: 'GREEN', real_money: true, level_needed: 'L0', label: 'sandbox' }] })
    if (url === '/api/workspace/account') return json({ account_type: (plan as { account_type: string }).account_type, money_kind: 'fiat' })
    return json({}, 404)
  })
  return puts
}

function renderPlan() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppMoney>
          <div data-design="pocket">
            <PlanSettings />
          </div>
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ladderNames = async () => {
  const section = await screen.findByRole('region', { name: /^Plans for/ })
  return within(section)
    .getAllByTestId(/^ladder-/)
    .map((card) => card.querySelector('p')?.textContent)
}

beforeEach(() => window.localStorage.setItem(FIAT_KEY, 'GBP'))
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('Settings, Plan', () => {
  it('shows a Personal account exactly Solo, Crew and Fleet, with Lens’s figures in its own currency', async () => {
    mockBff(PERSONAL)
    renderPlan()
    expect(await ladderNames()).toEqual(['Solo', 'Crew', 'Fleet'])
    const current = screen.getByTestId('plan-current')
    expect(current).toHaveTextContent('You are on Crew.')
    expect(current).toHaveTextContent('£4.12 a month')
    expect(current).toHaveTextContent('5 of 11')
    expect(current).toHaveTextContent('0.45% on exchange')
    expect(screen.getByTestId('ladder-personal_fleet')).toHaveTextContent('£8.12 a month')
    expect(screen.getByTestId('ladder-personal_fleet')).toHaveTextContent('27 agents')
    expect(screen.getByTestId('ladder-personal_fleet')).toHaveTextContent('No exchange fee')
    expect(within(screen.getByTestId('ladder-personal_crew')).getByText('Your plan')).toBeInTheDocument()
    expect(screen.getByTestId('plan-sandbox-line')).toHaveTextContent(PLAN_SANDBOX_LINE)
  })

  // B17.488 — LAUNCH-PACK.md section 4: "Nothing in the copy says real money is live". The e2e scenario
  // sandbox-label-every-screen read /billing's Sandbox line as saying it.
  it('never says real money is live, even in its Sandbox line', async () => {
    mockBff(PERSONAL)
    renderPlan()
    await ladderNames()
    expect(document.body.textContent).not.toMatch(/\breal money (?:moves|is moving|is live)\b/i)
    expect(document.body.textContent).not.toMatch(/\btest[\s-]money\b/i)
  })

  it('shows a Business account Studio, Company, Group and Custom, which opens an email to talk to us', async () => {
    mockBff(BUSINESS)
    renderPlan()
    expect(await ladderNames()).toEqual(['Studio', 'Company', 'Group', 'Custom'])
    expect(screen.getByTestId('ladder-business_group')).toHaveTextContent('£126.00 a month')
    expect(screen.getByTestId('ladder-business_group')).toHaveTextContent('Unlimited agents')
    expect(screen.getByRole('link', { name: 'Custom: talk to us' })).toHaveAttribute('href', 'mailto:hello@talyvor.com')
    expect(within(screen.getByTestId('ladder-business_custom')).queryByRole('button', { name: 'Change plan' })).toBeNull()
  })

  it('names no LXC and no 5 Oct plan', async () => {
    mockBff(BUSINESS)
    const { container } = renderPlan()
    await ladderNames()
    expect(container.textContent).not.toMatch(/LXC|\bTeam\b|\bFree\b|\bBusiness\b|\bEnterprise\b/)
  })

  it('asks once to confirm, says what changes, and sends the plan', async () => {
    const puts = mockBff(PERSONAL, { status: 200, body: { from: 'personal_crew', plan: 'personal_fleet', name: 'Fleet' } })
    renderPlan()
    await ladderNames()
    fireEvent.click(within(screen.getByTestId('ladder-personal_fleet')).getByRole('button', { name: 'Change plan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change to Fleet?' })
    expect(within(dialog).getByTestId('plan-change-lines')).toHaveTextContent('You pay £8.12 a month instead of £4.12.')
    expect(within(dialog).getByTestId('plan-change-lines')).toHaveTextContent('27 agents instead of 11 agents.')
    expect(puts).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change to Fleet' }))
    await waitFor(() => expect(puts).toEqual([{ plan: 'personal_fleet' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('reads the new plan before the dialog closes, so Your plan names it the moment the change is done', async () => {
    const STUDIO = { ...BUSINESS, plan: 'business_studio', name: 'Studio', price_minor: { GBP: 1100, EUR: 1100, USD: 1100 }, agents: 3 }
    let moved = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/plan' && init?.method === 'PUT') {
        moved = true
        return json({ from: 'business_studio', plan: 'business_company', name: 'Company' })
      }
      if (url === '/api/plan') {
        if (!moved) return json(STUDIO)
        await new Promise((r) => setTimeout(r, 50))
        return json(BUSINESS)
      }
      if (url === '/api/pricing')
        return json({ min_usd_cents: 0, max_usd_cents: 0, preset_usd_cents: [], ladders: LADDERS, fees: FEES, card_payments: 'test' })
      if (url === '/api/workspace/account') return json({ account_type: 'business', money_kind: 'fiat' })
      return json({}, 404)
    })
    renderPlan()
    await ladderNames()
    expect(screen.getByTestId('plan-current')).toHaveTextContent('You are on Studio.')
    fireEvent.click(within(screen.getByTestId('ladder-business_company')).getByRole('button', { name: 'Change plan' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change to Company' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('plan-current')).toHaveTextContent('You are on Company.')
    expect(screen.getByTestId('plan-current')).toHaveTextContent('2 of 26')
  })

  it('says Lens’s sentence when a move down is refused under too many agents', async () => {
    const sentence = 'Solo allows 4 agents, and this account has 5. Archive 1 agent first.'
    mockBff(PERSONAL, { status: 409, body: { error: sentence } })
    renderPlan()
    await ladderNames()
    fireEvent.click(within(screen.getByTestId('ladder-personal_solo')).getByRole('button', { name: 'Change plan' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change to Solo' }))
    expect(await screen.findByTestId('plan-change-refusal')).toHaveTextContent(sentence)
  })
})
