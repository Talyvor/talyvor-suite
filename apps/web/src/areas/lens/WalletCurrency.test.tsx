import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { FIAT_KEY } from './money'

// B28.22 — the DONE line: 12.5 LXC renders with its dollar value, and the model field is a picker, not
// a text box. Also: the same amount in pounds at the ECB's rate, and the saved rules as plain sentences.

const M = 1_000_000

function mockBff() {
  const saved: Record<string, unknown>[] = []
  let rules: Record<string, unknown> = {
    max_per_request_ulxc: 0, daily_limit_ulxc: 20 * M, monthly_limit_ulxc: 0, approval_above_ulxc: 5 * M,
    allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '',
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    // B55.14: Lens judges a change to an agent's rules first; these do not loosen them.
    if (url.endsWith('/rules-challenge')) return json({ looser: false, changes: [], allow_credentials: [] })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 12.5 * M, unallocated_ulxc: 87.5 * M, spent_ulxc: 0,
        agents: [
          { id: 'agt_1', name: 'Researcher', balance_ulxc: 12.5 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' },
          { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:05:00Z' },
        ],
      })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
    if (url === '/api/fx') return json({ rate_date: '2026-10-02', usd_per_eur: 1.1672, gbp_per_eur: 0.8354 })
    if (url === '/api/models')
      return json([
        { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5 },
        { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 },
      ])
    if (url === '/api/agents/agt_1/rules') {
      if (init?.method === 'PUT') {
        rules = JSON.parse(String(init.body)) as Record<string, unknown>
        saved.push(rules)
      }
      return json(rules)
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    return new Response('null', { status: 404 })
  })
  return { saved }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.localStorage.removeItem(FIAT_KEY)
  window.history.pushState({}, '', '/')
})

const balanceRow = () => screen.getByTestId('agent-balance-agt_1')

describe('amounts in your own currency and plain-English rules', () => {
  it('shows 12.5 LXC with its dollar value, and in pounds once pounds are chosen', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    await waitFor(() => expect(balanceRow().textContent).toBe('$1.25 (12.5 LXC)'))
    expect(within(balanceRow()).getByTestId('fiat').className).toContain('font-figure')

    // B57.42 — Show amounts in moved to Settings: chosen there, followed here.
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }))
    fireEvent.click(within(await screen.findByRole('tablist', { name: 'Show amounts in' })).getByRole('tab', { name: 'Pounds' }))
    fireEvent.click(screen.getByRole('link', { name: 'Agents' }))
    // 1.25 USD ÷ 1.1672 USD per EUR × 0.8354 GBP per EUR = £0.8947 — on the agent's card, as B57.19's list draws it.
    await waitFor(() => expect(screen.getByTestId('agent-card-balance-agt_1')).toHaveTextContent('£0.89'))
    expect(screen.getByTestId('agent-card-balance-agt_1')).toHaveTextContent('12.5 LXC')
    expect(window.localStorage.getItem(FIAT_KEY)).toBe('GBP')
  })

  // B57.23 — the rules are edited on their own page; today's agent view states them as sentences.
  it('picks allowed models from the catalog instead of typing them, and states the rules as sentences', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    const before = await screen.findByTestId('rules-in-words')
    await waitFor(() => expect(before.textContent).toContain('Researcher may spend at most $2.00 (20 LXC) a day.'))
    expect(before.textContent).toContain('A person must approve any request or payment above $0.50 (5 LXC).')
    expect(before.textContent).toContain('It may use any model from any provider.')

    await rulesPage()
    fireEvent.click(screen.getByRole('switch', { name: 'Only these models' }))
    const models = await screen.findByLabelText('Add to models Researcher may use')
    expect(models.tagName).toBe('SELECT')
    expect(screen.queryByRole('textbox', { name: /models/ })).toBeNull()
    expect((screen.getByLabelText('Researcher works from') as HTMLInputElement).type).toBe('time')
    more('Only these providers')
    expect(screen.getByLabelText('Add to providers Researcher may use').tagName).toBe('SELECT')
    more('Time zone')
    expect(screen.getByLabelText('Time zone for Researcher').tagName).toBe('SELECT')

    await waitFor(() => expect(within(models).getByRole('option', { name: 'Claude Haiku 4.5' })).toBeTruthy())
    fireEvent.change(models, { target: { value: 'claude-haiku-4-5' } })
    expect(screen.getByRole('button', { name: 'Take Claude Haiku 4.5 off' })).toBeTruthy()
    const words = await save(saved, 1)
    expect(saved[0].allowed_models).toEqual(['claude-haiku-4-5'])
    await waitFor(() => expect(words.textContent).toContain('It may use only Claude Haiku 4.5.'))
  })

  // B28.24 — the hourly and weekly caps are typed like the others, saved, and read back as one sentence.
  it('saves an hourly and a weekly cap and states them with the daily one', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Researcher’s rules' })
    more('At most an hour')
    fireEvent.change(screen.getByLabelText('At most an hour for Researcher, in LXC'), { target: { value: '1' } })
    more('At most a week')
    fireEvent.change(screen.getByLabelText('At most a week for Researcher, in LXC'), { target: { value: '50' } })
    const words = await save(saved, 1)
    expect(saved[0]).toMatchObject({ hourly_limit_ulxc: 1 * M, daily_limit_ulxc: 20 * M, weekly_limit_ulxc: 50 * M })
    await waitFor(() =>
      expect(words.textContent).toContain('Researcher may spend at most $0.10 (1 LXC) an hour, $2.00 (20 LXC) a day and $5.00 (50 LXC) a week.'),
    )
  })

  // B28.25 — a model is picked and given its own daily cap; the caps are saved as one map and stated.
  it('caps one model a day, saves the cap by the model, and states it', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Researcher’s rules' })
    more('At most a day on one model')
    const pick = await screen.findByLabelText('Add to a day on one model for Researcher')
    expect(pick.tagName).toBe('SELECT')
    await waitFor(() => expect(within(pick).getByRole('option', { name: 'GPT-4o' })).toBeTruthy())
    fireEvent.change(pick, { target: { value: 'gpt-4o' } })
    fireEvent.change(screen.getByLabelText('A day on one model for Researcher: GPT-4o, in LXC'), { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText('Add to a day on one model for Researcher'), { target: { value: 'claude-haiku-4-5' } })
    fireEvent.change(screen.getByLabelText('A day on one model for Researcher: Claude Haiku 4.5, in LXC'), { target: { value: '2' } })
    const words = await save(saved, 1)
    expect(saved[0].model_daily_limits_ulxc).toEqual({ 'gpt-4o': 0.5 * M, 'claude-haiku-4-5': 2 * M })
    await waitFor(() =>
      expect(words.textContent).toContain('On one model it may spend at most $0.05 (0.5 LXC) a day on GPT-4o and $0.20 (2 LXC) a day on Claude Haiku 4.5.'),
    )

    await rulesPage()
    more('At most a day on one model')
    fireEvent.click(screen.getByRole('button', { name: 'Take GPT-4o off' }))
    await save(saved, 2)
    expect(saved[1].model_daily_limits_ulxc).toEqual({ 'claude-haiku-4-5': 2 * M })
  })

  // B28.26 — the owner caps the agent's requests a minute: a whole number, saved and stated.
  it('saves a cap on requests a minute and states it', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    fireEvent.click(await screen.findByRole('switch', { name: 'At most requests a minute' }))
    const rate = screen.getByLabelText('Requests a minute for Researcher')
    fireEvent.change(rate, { target: { value: '6.5' } })
    expect(screen.getByText('Requests a minute is a whole number, or empty.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save rules' })).toHaveProperty('disabled', true)
    fireEvent.change(rate, { target: { value: '60' } })
    const words = await save(saved, 1)
    expect(saved[0].requests_per_minute).toBe(60)
    await waitFor(() => expect(words.textContent).toContain('It may make at most 60 requests a minute.'))
  })

  // B28.27 — the owner names who the agent may pay and who it may not: a payee is one or the other, saved
  // as Lens's two lists and stated.
  it('blocks one payee and allows another, saves both lists, and states them', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Researcher’s rules' })
    more('Never these payees')
    fireEvent.change(screen.getByLabelText('Add to payees Researcher may never pay'), { target: { value: 'agt_2' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Only these payees' }))
    fireEvent.change(screen.getByLabelText('A payee’s id to add to payees Researcher may pay'), { target: { value: ' ws_acme ' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Payees Researcher may pay' })).getByRole('button', { name: 'Add' }))
    const words = await save(saved, 1)
    expect(saved[0]).toMatchObject({ allowed_payees: ['ws_acme'], blocked_payees: ['agt_2'] })
    await waitFor(() => expect(words.textContent).toContain('It may pay only ws_acme.'))
    expect(words.textContent).toContain('It may never pay Writer.')

    // Allowing a blocked payee unblocks it: Lens refuses a payee on both lists.
    await rulesPage()
    fireEvent.change(screen.getByLabelText('Add to payees Researcher may pay'), { target: { value: 'agt_2' } })
    await save(saved, 2)
    expect(saved[1]).toMatchObject({ allowed_payees: ['ws_acme', 'agt_2'], blocked_payees: [] })
  })

  // B28.28 — the owner caps what the agent may pay one payee in a day: the workspace's own agent from the list, any
  // other payee by its id; saved as Lens's map in µLXC, a payee taken off left out, and stated.
  it('caps what the agent may pay one payee a day, saves the caps, and states them', async () => {
    const { saved } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Researcher’s rules' })
    more('At most a day to one payee')
    fireEvent.change(screen.getByLabelText('Add to a day to one payee from Researcher'), { target: { value: 'agt_2' } })
    fireEvent.change(screen.getByLabelText('A day to one payee from Researcher: Writer, in LXC'), { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText('A payee’s id to add to a day to one payee from Researcher'), { target: { value: 'merchant_9' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'A day to one payee from Researcher' })).getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('A day to one payee from Researcher: merchant_9, in LXC'), { target: { value: '2' } })
    const words = await save(saved, 1)
    expect(saved[0].payee_daily_limits_ulxc).toEqual({ agt_2: 0.5 * M, merchant_9: 2 * M })
    await waitFor(() => expect(words.textContent).toContain('To one payee it may pay at most'))
    expect(words.textContent).toMatch(/0\.5 LXC.* a day to Writer and .*2 LXC.* a day to merchant_9\./)

    await rulesPage()
    more('At most a day to one payee')
    fireEvent.click(screen.getByRole('button', { name: 'Take Writer off' }))
    await save(saved, 2)
    expect(saved[1].payee_daily_limits_ulxc).toEqual({ merchant_9: 2 * M })
  })
})

/** B57.23 — from today's agent view to the agent's rules page. */
async function rulesPage() {
  fireEvent.click(await screen.findByRole('link', { name: 'Edit Researcher’s rules, see their history or ask whether a request would pass' }))
  await screen.findByRole('heading', { level: 1, name: 'Researcher’s rules' })
}

const more = (rule: string) => fireEvent.click(within(screen.getByTestId('more-rules')).getByRole('link', { name: new RegExp(`^${rule}`) }))

/** Save rules, and the sentences today's agent view states them in once the page goes back to it. */
async function save(saved: unknown[], n: number) {
  fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
  await waitFor(() => expect(saved).toHaveLength(n))
  return screen.findByTestId('rules-in-words')
}

// B35.6 — one failed read of Lens's peg no longer leaves every amount without its dollar figure.
describe('the dollar figure survives a failed read of the peg', () => {
  /**
   * The BFF of mockBff, but the first `failures` reads of the peg answer 502. No read answers before
   * `shown()`: the screen is up by then, so no part of it mounts later and reads the peg again — the
   * read after a failed one is the retry's.
   */
  function failPeg(failures: number) {
    mockBff()
    const bff = vi.mocked(globalThis.fetch).getMockImplementation()!
    let reads = 0
    let shown!: () => void
    const up = new Promise<void>((resolve) => (shown = resolve))
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input) !== '/api/lxc/topup-options') return bff(input, init)
      const read = ++reads
      await up
      return read <= failures ? new Response('upstream unreachable', { status: 502 }) : bff(input, init)
    })
    return { reads: () => reads, shown }
  }

  it('shows LXC alone while the peg is unread, and the dollars join it when the second read answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const peg = failPeg(1)
      window.history.pushState({}, '', '/agents/agt_1')
      render(<App />)

      await waitFor(() => expect(balanceRow().textContent).toBe('12.5 LXC'))
      peg.shown()
      await vi.advanceTimersByTimeAsync(2_000)
      await waitFor(() => expect(balanceRow().textContent).toBe('$1.25 (12.5 LXC)'))
      expect(peg.reads()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows LXC alone, never a guessed figure, when every read of the peg fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const peg = failPeg(Infinity)
      window.history.pushState({}, '', '/agents/agt_1')
      render(<App />)

      await waitFor(() => expect(balanceRow().textContent).toBe('12.5 LXC'))
      peg.shown()
      await vi.advanceTimersByTimeAsync(30_000)
      await waitFor(() => expect(peg.reads()).toBe(4))
      expect(balanceRow().textContent).toBe('12.5 LXC')
      expect(within(balanceRow()).queryByTestId('fiat')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
