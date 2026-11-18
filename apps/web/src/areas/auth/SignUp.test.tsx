import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// SignUp.test.tsx — B59.8: sign-up asks who the account is for, the kind of money, then a key, and (B61.20) confirms who
// you are, in the launch pack's words (SPEC 3.2; the design's P1, P2 and W1). The words are typed here rather than imported, so a changed word in
// signupWords.ts is red until the spec says so too.

const MEANINGS = ['signed in', 'email and phone confirmed', 'identity checked', 'company checked']

interface MockOptions {
  authenticated?: boolean
  /** B61.26 — a new number's sign-up session (the door's join), which steps 1 and 2 belong to */
  joining?: boolean
  passkeys?: unknown[]
  devices?: unknown[]
  /** B61.20 — the account's type, and the check the provider does not pass */
  accountType?: 'personal' | 'business'
  fails?: 'contact' | 'identity' | 'company'
  /** B61.118 — the check the provider has not decided yet */
  pending?: 'contact' | 'identity' | 'company'
  /** B61.110 — the countries Lens serves (GET /v1/public/countries, on /api/pricing), and one it refuses */
  served?: string[]
  refuses?: string
}

/** talyvor-lens B61.53's refusal of a country Talyvor does not serve. */
const NOT_SERVED = { code: 'country_not_served', error: 'Talyvor is not available in that country yet.', field: 'country' }

function mockFetch(o: MockOptions = {}) {
  const sent: Array<{ url: string; body: unknown }> = []
  // Lens B30.4's record: each check needs the one below it, newest first; the Test provider passes it in Sandbox.
  const checks: Array<Record<string, unknown>> = []
  const reached = () => checks.filter((c) => c.status === 'completed').length
  const record = () => ({ workspace_id: 'ws_1', level: `L${reached()}`, meaning: MEANINGS[reached()], live_level: 'L0', live_meaning: MEANINGS[0], checks: checks.length ? [...checks] : null })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/workspace/account') return json({ account_type: o.accountType ?? 'personal', money_kind: 'hybrid' })
    if (url === '/api/workspace/business') {
      return json({ company_name: 'Northwind Studio', registration_number: '12345678', country: 'GB', people: [{ name: 'Maya Lind', role: 'director', share_bps: 10000 }] })
    }
    if (url === '/api/pricing' && o.served) return json({ min_usd_cents: 1000, max_usd_cents: 1000000, preset_usd_cents: [1000], countries: o.served })
    if (url === '/api/verification') return json(record())
    const m = /^\/api\/verification\/(contact|identity|company)$/.exec(url)
    if (m && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { country?: string }
      sent.push({ url, body })
      if (o.refuses && body.country === o.refuses) return json(NOT_SERVED, 400)
      const level = ['contact', 'identity', 'company'].indexOf(m[1]) + 1
      if (reached() < level - 1) return json({ error: 'economy: verification levels are reached in order' }, 409)
      const status = o.fails === m[1] ? 'failed' : o.pending === m[1] ? 'pending' : 'completed'
      const check = { level: `L${level}`, subject: ['contact', 'person', 'company'][level - 1], method: 'test', test: true, status, evidence_ref: `test_kyc_${level}`, verified_name: level === 2 ? 'Maya Lind' : undefined, started_at: '2026-11-15T09:00:00Z', checked_at: '2026-11-15T09:00:00Z' }
      checks.unshift(check)
      return json({ check, verification: record() }, 201)
    }
    if (url === '/auth/me') {
      const authed = o.authenticated ?? o.joining ?? false
      return json({ mode: 'oidc', authenticated: authed, user: authed ? { sub: 's', email: 'maya@example.com' } : null, signup_open: true, ...(o.joining ? { signup_unfinished: true } : {}) })
    }
    if (url === '/auth/signup/account' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { country?: string }
      sent.push({ url, body })
      if (o.refuses && body.country === o.refuses) return json(NOT_SERVED, 400)
      return json({ account_id: 'ws_1', created: true })
    }
    if (url === '/api/agents/passkeys') return json({ passkeys: o.passkeys ?? [] })
    if (url === '/api/money/devices') return json({ devices: o.devices ?? [] })
    return new Response('null', { status: 404 })
  })
  return sent
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
    mockFetch({ joining: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })
    const steps = within(screen.getByRole('list', { name: 'Sign-up steps' })).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(['1Who is this account for?', '2Pick the kind of money', '3Add a passkey or pair your phone', '4Confirm who you are'])
    const choices = within(screen.getByRole('radiogroup')).getAllByRole('radio')
    expect(choices.map((c) => c.closest('label')!.textContent)).toEqual(['PersonalFor you and your own agents.', 'BusinessFor a company and its team.'])
    // B61.4 — the type is fixed once the account is open: another type is another account.
    expect(screen.getByText('The type can’t be changed later. To use another type, open another account.')).toBeInTheDocument()

    const labels = () => Array.from(document.querySelectorAll('main label[for]')).map((l) => l.textContent)
    pick(/^Personal/)
    expect(labels()).toEqual(['Your name', 'Country'])
    pick(/^Business/)
    expect(labels()).toEqual(['Company name', 'Registration number', 'Country'])
    expect(document.body.textContent).not.toMatch(/passport|identity document|driving licen[cs]e|date of birth/i)
  })

  it('cannot continue until a type is picked, and says what each type is missing', async () => {
    mockFetch({ joining: true })
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
    mockFetch({ joining: true })
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
    // B61.4 — and so is the kind of money.
    expect(screen.getByText('The kind of money can’t be changed later. To use another kind, open another account.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('can become Hybrid')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })).toBeInTheDocument()
  })

  it('sends each of the six choices to the BFF’s sign-up as its type and kind, with the country and a business’s registration number, landing on step 3', async () => {
    for (const kind of ['Personal', 'Business'] as const) {
      for (const [money, value] of [['Fiat only', 'fiat'], ['Stablecoin and crypto only', 'stablecoin'], ['Hybrid', 'hybrid']] as const) {
        const sent = mockFetch({ joining: true })
        at('/signup')
        await throughStep1(kind)
        if (kind === 'Business') expect(screen.getByText('For Northwind Studio, a Business account.')).toBeInTheDocument()
        pick(new RegExp(`^${money}`))
        cont()
        // B61.26 — the sign-up session makes its account at the BFF, then lands on step 3.
        await waitFor(() => expect(window.location.pathname).toBe('/signup/key'))
        expect(sent).toEqual([{
          url: '/auth/signup/account',
          body: {
            money_kind: value,
            account_type: kind.toLowerCase(),
            name: kind === 'Personal' ? 'Maya Lind' : 'Northwind Studio',
            country: 'GB',
            ...(kind === 'Business' ? { registration_number: '12345678' } : {}),
          },
        }])
        cleanup()
        queryClient.clear()
        vi.restoreAllMocks()
      }
    }
  })
})

describe('step 3: add a passkey or pair your phone', () => {
  it('offers a passkey here or the phone’s key, and goes on to confirm who you are, with a key or later', async () => {
    mockFetch({ authenticated: true })
    at('/signup/key')
    await screen.findByRole('heading', { level: 1, name: 'Add a passkey or pair your phone' })
    expect(screen.getByRole('list', { name: 'Sign-up steps' }).querySelector('[aria-current="step"]')).toHaveTextContent('3Add a passkey or pair your phone')
    expect(await screen.findByRole('button', { name: 'Make a passkey' })).toBeInTheDocument()
    expect(screen.getByText('Open Talyvor on your phone, sign in with this account and turn on Approve with Face ID.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open the app' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Do this later' })).toHaveAttribute('href', '/signup/confirm')
    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()

    mockFetch({ authenticated: true, devices: [{ id: 'd1', name: 'iPhone', created_at: '2026-11-11T00:00:00Z' }] })
    at('/signup/key')
    expect(await screen.findByText('Your phone now signs approvals.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/signup/confirm')
  })

  it('draws P1’s step bars for a narrow screen: four bars, three reached, and “Step 3 of 4”', async () => {
    mockFetch({ authenticated: true })
    at('/signup/key')
    const bars = await screen.findByText('Step 3 of 4')
    const row = bars.parentElement!
    expect(row.querySelectorAll('[data-step-bar]')).toHaveLength(4)
    expect(row.querySelectorAll('[data-step-bar="reached"]')).toHaveLength(3)
  })

  it('labels the new workspace from its own capabilities, and says Status unknown when that read fails (S-06)', async () => {
    mockFetch({ authenticated: true })
    at('/signup/key')
    expect(await screen.findByText('Status unknown')).toBeInTheDocument()
  })

  it('asks someone with no session to sign in first, at the door', async () => {
    mockFetch({ authenticated: false })
    at('/signup/key')
    expect(await screen.findByRole('heading', { level: 1, name: 'What’s your phone number?' })).toBeInTheDocument()
  })
})

describe('step 4: confirm who you are (B61.20)', () => {
  const fillYou = () => {
    type('Phone number', '+447700900123')
    type('Legal name', 'Maya Lind')
    type('Date of birth', '1990-04-01')
    type('Address line 1', ' 12 Marlborough Road ')
    type('Town or city', 'Twickenham')
    type('Postcode', 'TW1 3AA')
    fireEvent.change(screen.getByLabelText('Country you live in'), { target: { value: 'GB' } })
  }
  const run = () => fireEvent.click(screen.getByRole('button', { name: 'Confirm who I am' }))
  const row = (subject: string) => screen.getByTestId(`identity-${subject}`)

  it('a Personal sign-up ends on the identity step and opens Home only once the checks pass, uploading nothing', async () => {
    const sent = mockFetch({ authenticated: true })
    at('/signup/confirm')
    await screen.findByRole('heading', { level: 1, name: 'Confirm who you are' })
    expect(screen.getByRole('list', { name: 'Sign-up steps' }).querySelector('[aria-current="step"]')).toHaveTextContent('4Confirm who you are')
    expect(await screen.findByLabelText('Legal name')).toBeInTheDocument()
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('maya@example.com')
    expect(screen.getByText('Talyvor checks who you are before your account can move money. It takes a minute.')).toBeInTheDocument()
    expect(within(row('contact')).getByText('Not checked yet')).toBeInTheDocument()
    expect(screen.queryByTestId('identity-company')).toBeNull()
    expect(screen.queryByRole('form', { name: 'Company details' })).toBeNull()
    // the document step is the partner's place, and collects nothing
    expect(screen.getByRole('heading', { name: 'Your ID document' })).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open the app' })).toBeNull()

    fillYou()
    run()
    expect(await screen.findByText('You’re confirmed. Your account is open.')).toBeInTheDocument()
    expect(within(row('contact')).getByText('Passed in Sandbox')).toBeInTheDocument()
    expect(within(row('person')).getByText('Passed in Sandbox')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/')
    // B61.118 — once passed, no line about finishing the check later
    expect(screen.queryByTestId('identity-way-in')).toBeNull()
    expect(screen.queryByText(/in the background|try the check again/)).toBeNull()
    expect(sent).toEqual([
      { url: '/api/verification/contact', body: { email: 'maya@example.com', phone: '+447700900123' } },
      {
        url: '/api/verification/identity',
        body: {
          name: 'Maya Lind',
          country: 'GB',
          date_of_birth: '1990-04-01',
          // B61.46 — the home address goes with the identity check, its country the one they live in
          address: { lines: ['12 Marlborough Road'], town: 'Twickenham', postcode: 'TW1 3AA', country: 'GB' },
        },
      },
    ])
  })

  it('says what is missing before anything is sent', async () => {
    const sent = mockFetch({ authenticated: true })
    at('/signup/confirm')
    await screen.findByLabelText('Legal name')
    type('Email', '')
    run()
    for (const line of [
      'Add your email address.',
      'Add your phone number with its country code, like +447700900123.',
      'Add your legal name.',
      'Add your date of birth.',
      'Add the first line of your home address.',
      'Add your town or city.',
      'Add your postcode.',
      'Pick the country you live in.',
    ]) {
      expect(screen.getByText(line)).toBeInTheDocument()
    }
    expect(sent).toEqual([])
  })

  it('a Business sign-up also gives its company details and runs the company check', async () => {
    const sent = mockFetch({ authenticated: true, accountType: 'business' })
    at('/signup/confirm')
    expect(await screen.findByRole('form', { name: 'Company details' })).toBeInTheDocument()
    expect(screen.getByText('Talyvor checks who you are and your company before the account can move money. It takes a minute.')).toBeInTheDocument()
    expect(within(row('company')).getByText('Not checked yet')).toBeInTheDocument()
    fillYou()
    run()
    expect(await screen.findByText('You’re confirmed. Your account is open.')).toBeInTheDocument()
    expect(within(row('company')).getByText('Passed in Sandbox')).toBeInTheDocument()
    expect(sent.map((s) => s.url)).toEqual(['/api/verification/contact', '/api/verification/identity', '/api/verification/company'])
  })

  it('a check that does not pass says what to fix, and still lets the person into the app (B61.118)', async () => {
    mockFetch({ authenticated: true, fails: 'identity' })
    at('/signup/confirm')
    await screen.findByLabelText('Legal name')
    fillYou()
    run()
    expect(await screen.findByText('We couldn’t confirm who you are. Check your legal name, date of birth, home address and country, and try again.')).toBeInTheDocument()
    expect(within(row('contact')).getByText('Passed in Sandbox')).toBeInTheDocument()
    expect(within(row('person')).getByText('Not passed')).toBeInTheDocument()
    const wayIn = screen.getByTestId('identity-way-in')
    expect(within(wayIn).getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/')
    expect(wayIn).toHaveTextContent('You can try the check again from Settings, Verification.')
    expect(screen.queryByText('You’re confirmed. Your account is open.')).toBeNull()
    // the form stays, to try again here
    expect(screen.getByRole('button', { name: 'Confirm who I am' })).toBeInTheDocument()
  })

  it('while the person check waits for the checker, a way into the app says the check finishes in the background (B61.118)', async () => {
    mockFetch({ authenticated: true, pending: 'identity' })
    at('/signup/confirm')
    await screen.findByLabelText('Legal name')
    fillYou()
    run()
    const wayIn = await screen.findByTestId('identity-way-in')
    expect(within(row('contact')).getByText('Passed in Sandbox')).toBeInTheDocument()
    expect(within(row('person')).getByText('Waiting for the checker')).toBeInTheDocument()
    expect(within(wayIn).getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/')
    expect(wayIn).toHaveTextContent('You can look around now. Once your identity check passes, you can move money.')
    expect(screen.queryByText('You’re confirmed. Your account is open.')).toBeNull()
  })

  it('a new account’s identity step has the same way into the app while its check waits (B61.118)', async () => {
    mockFetch({ authenticated: true, pending: 'identity' })
    at('/accounts/new/confirm')
    await screen.findByLabelText('Legal name')
    fillYou()
    run()
    const wayIn = await screen.findByTestId('identity-way-in')
    expect(within(wayIn).getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/')
    expect(wayIn).toHaveTextContent('You can look around now. Once your identity check passes, you can move money.')
  })

  it('until the checks pass, Home says so in one sentence and leads back to the step', async () => {
    mockFetch({ authenticated: true })
    at('/')
    const gate = await screen.findByTestId('identity-gate')
    expect(gate).toHaveTextContent('Your account can look around but can’t move money until you confirm who you are.')
    expect(within(gate).getByRole('link', { name: 'Finish confirming who you are' })).toHaveAttribute('href', '/signup/confirm')
  })
})

describe('the countries Lens serves (B61.110)', () => {
  const offered = (label: string) =>
    Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).filter((o) => o.value).map((o) => [o.value, o.textContent])

  it('sign-up and the identity check offer exactly the codes Lens serves, by the app’s names, and a code it has no name for by its code', async () => {
    mockFetch({ joining: true, served: ['US', 'XK', 'GB'] })
    at('/signup')
    await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })
    pick(/^Personal/)
    await waitFor(() => expect(offered('Country')).toEqual([['GB', 'United Kingdom'], ['US', 'United States'], ['XK', 'XK']]))
    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()

    mockFetch({ authenticated: true, served: ['US', 'XK', 'GB'] })
    at('/signup/confirm')
    await screen.findByLabelText('Legal name')
    await waitFor(() => expect(offered('Country you live in')).toEqual([['GB', 'United Kingdom'], ['US', 'United States'], ['XK', 'XK']]))
  })

  it('a country Lens refuses at sign-up goes back to step 1 with Lens’s sentence on the country field', async () => {
    mockFetch({ joining: true, refuses: 'GB' })
    at('/signup')
    await throughStep1('Personal')
    pick(/^Hybrid/)
    cont()
    await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })
    const said = screen.getByText('Talyvor is not available in that country yet.')
    expect(screen.getByLabelText('Country')).toHaveAttribute('aria-describedby', said.closest('p')!.id)
    expect(window.location.pathname).toBe('/signup')
  })

  it('a country Lens refuses at the identity check puts Lens’s sentence on the country field', async () => {
    mockFetch({ authenticated: true, refuses: 'GB' })
    at('/signup/confirm')
    await screen.findByLabelText('Legal name')
    type('Phone number', '+447700900123')
    type('Legal name', 'Maya Lind')
    type('Date of birth', '1990-04-01')
    type('Address line 1', '12 Marlborough Road')
    type('Town or city', 'Twickenham')
    type('Postcode', 'TW1 3AA')
    fireEvent.change(screen.getByLabelText('Country you live in'), { target: { value: 'GB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm who I am' }))
    const said = await screen.findByText('Talyvor is not available in that country yet.')
    expect(screen.getByLabelText('Country you live in')).toHaveAttribute('aria-describedby', said.closest('p')!.id)
    expect(screen.queryByText('We couldn’t confirm who you are. Check your legal name, date of birth, home address and country, and try again.')).toBeNull()
  })
})
