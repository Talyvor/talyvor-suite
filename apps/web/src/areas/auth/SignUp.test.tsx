import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// SignUp.test.tsx — B59.8: sign-up asks who the account is for, the kind of money, then a key, in the launch pack's
// words (SPEC 3.2; the design's P1, P2 and W1). The words are typed here rather than imported, so a changed word in
// signupWords.ts is red until the spec says so too.

function mockFetch(o: { authenticated?: boolean; passkeys?: unknown[]; devices?: unknown[] } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') {
      return json({ mode: 'oidc', authenticated: o.authenticated ?? false, user: o.authenticated ? { sub: 's', email: 'maya@example.com' } : null, signup_open: true })
    }
    if (url === '/api/agents/passkeys') return json({ passkeys: o.passkeys ?? [] })
    if (url === '/api/money/devices') return json({ devices: o.devices ?? [] })
    return new Response('null', { status: 404 })
  })
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  queryClient.clear()
  // A browser that makes passkeys, so step 3 offers one.
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
  Object.defineProperty(navigator, 'credentials', { value: {}, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'credentials')
  window.history.pushState({}, '', '/')
})

const pick = (name: RegExp | string) => fireEvent.click(screen.getByRole('radio', { name }))
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const cont = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

/** Step 1 filled in for a type, then Continue. */
async function throughStep1(kind: 'Personal' | 'Business') {
  await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })
  pick(new RegExp(`^${kind}`))
  if (kind === 'Personal') type('Your name', 'Maya Lind')
  else {
    type('Company name', 'Northwind Studio')
    type('Registration number', '12345678')
  }
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'GB' } })
  cont()
  await screen.findByRole('heading', { level: 1, name: 'Pick the kind of money' })
}

describe('step 1: who is this account for?', () => {
  it('says the spec’s words, asks each type for its own profile and no identity document', async () => {
    mockFetch()
    at('/signup')
    await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })
    const steps = within(screen.getByRole('list', { name: 'Sign-up steps' })).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(['1Who is this account for?', '2Pick the kind of money', '3Add a passkey or pair your phone'])
    const choices = within(screen.getByRole('radiogroup')).getAllByRole('radio')
    expect(choices.map((c) => c.closest('label')!.textContent)).toEqual(['PersonalFor you and your own agents.', 'BusinessFor a company and its team.'])
    expect(screen.getByText('The type can’t be changed later. You can hold several accounts and switch between them.')).toBeInTheDocument()

    const labels = () => Array.from(document.querySelectorAll('main label[for]')).map((l) => l.textContent)
    pick(/^Personal/)
    expect(labels()).toEqual(['Your name', 'Country'])
    pick(/^Business/)
    expect(labels()).toEqual(['Company name', 'Registration number', 'Country'])
    expect(document.body.textContent).not.toMatch(/passport|identity document|driving licen[cs]e|date of birth/i)
  })

  it('cannot continue until a type is picked, and says what each type is missing', async () => {
    mockFetch()
    at('/signup')
    await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    pick(/^Personal/)
    cont()
    expect(screen.getByText('Add your name.')).toBeInTheDocument()
    expect(screen.getByText('Pick your country.')).toBeInTheDocument()
    pick(/^Business/)
    cont()
    expect(screen.getByText('Add the company name.')).toBeInTheDocument()
    expect(screen.getByText('Add the registration number.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Who is this account for?')
  })
})

describe('step 2: pick the kind of money', () => {
  it('says the spec’s words and W1’s lists, for the account it is making', async () => {
    mockFetch()
    at('/signup')
    await throughStep1('Personal')
    expect(screen.getByText('For Maya Lind, a Personal account.')).toBeInTheDocument()
    const choices = within(screen.getByRole('radiogroup')).getAllByRole('radio')
    expect(choices.map((c) => c.closest('label')!.querySelector('span.pr-8')!.textContent)).toEqual(['Fiat only', 'Stablecoin and crypto only', 'Hybrid'])
    const lines = choices.map((c) => within(c.closest('label')!).getAllByText(/\.$/)[0].textContent)
    expect(lines).toEqual(['Your agents pay ordinary bills with cards and bank transfers.', 'Your agents work on chain.', 'Both side by side, under one set of rules.'])
    const lists = choices.map((c) => within(c.closest('label')!).getAllByRole('listitem').map((li) => li.textContent))
    expect(lists).toEqual([
      ['Balances in GBP, EUR and USD', 'Cards with Personal art', 'Bank transfers in and out'],
      ['Stablecoin and crypto balances', 'A card that spends from the stablecoin balance', 'Wallet addresses, on-chain send and receive'],
      ['Both balances, one total with the split', 'All cards', 'Convert between the two sides', 'Instant transfer'],
    ])
    expect(screen.getByText('Fiat only or Stablecoin and crypto only can become Hybrid at any time.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })).toBeInTheDocument()
  })

  it('sends each of the six choices to the BFF’s sign-up as its type and kind, with the country and a business’s registration number, landing on step 3', async () => {
    for (const kind of ['Personal', 'Business'] as const) {
      for (const [money, value] of [['Fiat only', 'fiat'], ['Stablecoin and crypto only', 'stablecoin'], ['Hybrid', 'hybrid']] as const) {
        mockFetch()
        at('/signup')
        await throughStep1(kind)
        if (kind === 'Business') expect(screen.getByText('For Northwind Studio, a Business account.')).toBeInTheDocument()
        pick(new RegExp(`^${money}`))
        const go = new URL(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')!, 'https://app.example')
        expect(go.pathname).toBe('/auth/login')
        expect(Object.fromEntries(go.searchParams)).toEqual({
          money_kind: value,
          account_type: kind.toLowerCase(),
          name: kind === 'Personal' ? 'Maya Lind' : 'Northwind Studio',
          country: 'GB',
          ...(kind === 'Business' ? { registration_number: '12345678' } : {}),
          return_to: '/signup/key',
        })
        cleanup()
        queryClient.clear()
        vi.restoreAllMocks()
      }
    }
  })
})

describe('step 3: add a passkey or pair your phone', () => {
  it('offers a passkey here or the phone’s key, and opens the app once one is there', async () => {
    mockFetch({ authenticated: true })
    at('/signup/key')
    await screen.findByRole('heading', { level: 1, name: 'Add a passkey or pair your phone' })
    expect(screen.getByRole('list', { name: 'Sign-up steps' }).querySelector('[aria-current="step"]')).toHaveTextContent('3Add a passkey or pair your phone')
    expect(await screen.findByRole('button', { name: 'Make a passkey' })).toBeInTheDocument()
    expect(screen.getByText('Open Talyvor on your phone, sign in with this account and turn on Approve with Face ID.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open the app' })).toBeNull()
    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()

    mockFetch({ authenticated: true, devices: [{ id: 'd1', name: 'iPhone', created_at: '2026-11-11T00:00:00Z' }] })
    at('/signup/key')
    expect(await screen.findByText('Your phone now signs approvals.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/')
  })

  it('draws P1’s step bars for a narrow screen: three bars, all reached, and “Step 3 of 3”', async () => {
    mockFetch({ authenticated: true })
    at('/signup/key')
    const bars = await screen.findByText('Step 3 of 3')
    const row = bars.parentElement!
    expect(row.querySelectorAll('[data-step-bar]')).toHaveLength(3)
    expect(row.querySelectorAll('[data-step-bar="reached"]')).toHaveLength(3)
  })

  it('labels the new workspace from its own capabilities, and says Status unknown when that read fails (S-06)', async () => {
    mockFetch({ authenticated: true })
    at('/signup/key')
    expect(await screen.findByText('Status unknown')).toBeInTheDocument()
  })

  it('asks someone with no session to sign in first, and brings them back to step 3', async () => {
    mockFetch({ authenticated: false })
    at('/signup/key')
    const signIn = await screen.findByRole('link', { name: /^sign in$/i })
    expect(signIn).toHaveAttribute('href', `/auth/login?return_to=${encodeURIComponent('/signup/key')}`)
  })
})
