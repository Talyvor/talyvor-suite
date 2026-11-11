import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'

// B59.10 — each type and each kind shows only what it has (SPEC 3.3 and 3.4). For each of the six combinations Home,
// Pay, Cards, Settings and Wallets render off the populated fixture, with Lens's account answering the combination,
// and nothing the combination hides is in the page: hidden means not rendered, never greyed out.

const TYPES = ['business', 'personal'] as const
const KINDS = ['fiat', 'stablecoin', 'hybrid'] as const
const CHIP = { business: 'Business', personal: 'Personal', fiat: 'Fiat', stablecoin: 'Stablecoin', hybrid: 'Hybrid' }
const KIND_LABEL = { fiat: 'Fiat only', stablecoin: 'Stablecoin and crypto only', hybrid: 'Hybrid' }
const TIERS = { business: ['Team', 'Business', 'Enterprise'], personal: ['Daily', 'Premium', 'Platinum'] }

// The Researcher's wallet as a partner that gives both an address and an IBAN would serve it, so the kind alone
// decides which of the two is drawn.
const WALLET = {
  account_id: 'macc_research',
  agent_id: 'agt_research',
  asset: 'USDC',
  partner: 'sandbox',
  balance_minor: 2_500_000,
  receive: { asset: 'USDC', network: 'base', address: '0x00000000000000000000000000000000000000a1', holder: 'Researcher', iban: 'GB33BUKB20201555555555' },
  mode: 'LIVE',
}

async function at(address: string, account: { account_type: string; money_kind: string }) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
    '/api/workspace/account': account,
    '/api/agents/agt_research/wallet': WALLET,
  })
  window.history.pushState({}, '', address)
  render(<App />)
  const nav = await screen.findByRole('navigation', { name: /sections/i })
  await settleQueries(queryClient, waitFor)
  return { nav, main: document.querySelector('main') as HTMLElement }
}

afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

describe.each(TYPES.flatMap((t) => KINDS.map((k) => [t, k] as const)))('a %s account with %s money', (type, kind) => {
  const account = { account_type: type, money_kind: kind }
  const business = type === 'business'

  it('Home: the chip, and the agents in its words', async () => {
    const { nav, main } = await at('/', account)
    expect(within(nav).getByTestId('sidebar-account-chip').textContent).toBe(`${CHIP[type]} · ${CHIP[kind]}`)
    expect(within(main).queryByText('Your team’s agents') !== null).toBe(business)
    expect(within(main).queryByText('Your agents') !== null).toBe(!business)
  })

  it('Pay: bank transfers only where the kind has them, payout batches and company words only for a Business', async () => {
    const { main } = await at('/money/pay', account)
    const text = main.textContent ?? ''
    expect(within(main).queryByRole('heading', { name: 'People and companies you pay' }) !== null).toBe(kind !== 'stablecoin')
    expect(within(main).queryByLabelText('Account details') !== null).toBe(kind !== 'stablecoin')
    expect(within(main).queryByTestId('pay-on-chain') !== null).toBe(kind === 'stablecoin')
    expect(within(main).queryByRole('heading', { name: 'Pay many at once from a file' }) !== null).toBe(business && kind !== 'stablecoin')
    expect(within(main).queryByLabelText('Payouts CSV') !== null).toBe(business && kind !== 'stablecoin')
    if (!business) expect(text).not.toMatch(/company’s|The company/)
  })

  it('Cards: no owner card tier of the other type', async () => {
    const { main } = await at('/money/card', account)
    const other = TIERS[business ? 'personal' : 'business']
    for (const tier of other) expect(within(main).queryByText(new RegExp(`\\b${tier}\\b`))).toBeNull()
  })

  it('Settings: the kind and the type, and the team and Members only for a Business', async () => {
    // B57.8 — Members left the sidebar: Settings links it.
    const { main } = await at('/settings', account)
    const pages = within(main).getByRole('navigation', { name: 'Settings pages' })
    expect(within(pages).queryByRole('link', { name: 'Members' }) !== null).toBe(business)
    expect(within(main).getByTestId('settings-money-kind').textContent).toContain(KIND_LABEL[kind])
    expect(within(main).getByTestId('settings-account-type').textContent).toContain(CHIP[type])
    expect(within(main).queryByTestId('settings-team') !== null).toBe(business)
  })

  it('Wallets: the address only for on-chain money, the IBAN and Send only for bank money', async () => {
    const { main } = await at('/agents', account)
    await within(main).findByTestId('agent-money-wallet')
    // A partner gives one of the two, the address first; a Hybrid account draws the address.
    expect(within(main).queryByTestId('wallet-address') !== null).toBe(kind !== 'fiat')
    expect(within(main).queryByTestId('wallet-iban') !== null).toBe(kind === 'fiat')
    expect(within(main).queryByRole('region', { name: 'Send money' }) !== null).toBe(kind !== 'stablecoin')
  })
})
