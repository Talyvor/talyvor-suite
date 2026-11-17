import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.22 — the DONE line: Nicolai downloads last month's CSV statement for the whole bank, and the file opens with its
// opening and closing balances. The mock BFF answers the period
// statement the way Lens B19.5 writes it; the test reads the file the screen hands the browser.

const CSV = (account: string) =>
  'posting_id,entry_id,at,account,kind,amount_ulxc,counterparty,ref,balance_after_ulxc\r\n' +
  `,,2026-08-01T00:00:00Z,${account},opening,,,,0\r\n` +
  `7,ent_1,2026-08-03T10:00:00Z,${account},fund,5000000,workspace,,5000000\r\n` +
  `,,2026-09-01T00:00:00Z,${account},closing,,,,5000000\r\n`

// B28.55 — the PDF as Lens B28.328 writes it: each cell one string shown on the page, in the CSV's row order.
const PDF = '%PDF-1.4\n(agent:agt_1) Tj (opening) Tj (0 LXC) Tj\n(agent:agt_1) Tj (closing) Tj (5 LXC) Tj\n%%EOF\n'

// B28.56 — the journal as Lens B28.329 writes it: one balanced journal per entry, the agent its cost centre.
const JOURNAL =
  'journal_no,date,account,description,debit_lxc,credit_lxc,cost_centre,ref\r\n' +
  'ent_1,2026-08-03,agent:agt_1,fund,5.000000,,agt_1,\r\n' +
  'ent_1,2026-08-03,workspace,fund,,5.000000,agt_1,\r\n'

function mockBff() {
  const asked: string[] = []
  const saved: Array<{ name: string; text: Promise<string> }> = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((b: Blob) => {
    // Which Blob fetch hands back depends on the Node version: its own has .text(), jsdom's is read
    // with FileReader (which refuses Node's).
    const text =
      typeof b.text === 'function'
        ? b.text()
        : new Promise<string>((resolve) => {
            const fr = new FileReader()
            fr.onload = () => resolve(String(fr.result))
            fr.readAsText(b)
          })
    saved.push({ name: '', text })
    return 'blob:statement'
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved[saved.length - 1].name = this.download
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const csv = (account: string) => {
      asked.push(url)
      return new Response(CSV(account), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
    }
    if (url === '/api/agents/agt_1/statement?from=2026-08-01&to=2026-09-01&format=csv') return csv('agent:agt_1')
    // B57.24 — Statements' two downloads are this month so far.
    if (url === '/api/agents/agt_1/statement?from=2026-09-01&to=2026-09-29&format=csv') return csv('agent:agt_1')
    if (url === '/api/agents/statement?from=2026-09-01&to=2026-09-29&format=csv') return csv('workspace')
    if (url === '/api/agents/statement?from=2026-08-01&to=2026-09-01&format=csv') return csv('workspace')
    // B57.112 — and as a PDF when the file type says so.
    if (url === '/api/agents/agt_1/statement?from=2026-09-01&to=2026-09-29&format=pdf' || url === '/api/agents/statement?from=2026-09-01&to=2026-09-29&format=pdf') {
      asked.push(url)
      return new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    }
    if (url === '/api/agents/agt_1/statement?from=2026-08-01&to=2026-09-01&format=pdf') {
      asked.push(url)
      return new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    }
    // B57.113 — and as the journal for Xero or QuickBooks.
    if (url === '/api/agents/agt_1/statement?from=2026-09-01&to=2026-09-29&format=journal' || url === '/api/agents/statement?from=2026-09-01&to=2026-09-29&format=journal') {
      asked.push(url)
      return new Response(JOURNAL, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
    }
    if (url === '/api/agents/statement?from=2026-08-01&to=2026-09-01&format=journal') {
      asked.push(url)
      return new Response(JOURNAL, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
    }
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 20_000_000, allocated_ulxc: 5_000_000, unallocated_ulxc: 15_000_000, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 5_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z' }],
      })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return { asked, saved }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  queryClient.clear()
})

// B61.55 — the agents' credit statements are parked off an agent's page and Statements: what they spent before stays
// downloadable under Settings › Your data, every agent in one file, for a period.
describe('the agents’ past statements under Your data', () => {
  async function yourData() {
    window.history.pushState({}, '', '/settings/data')
    render(<App />)
    const card = (await screen.findByRole('heading', { name: 'Your agents’ past statements' })).parentElement as HTMLElement
    return within(card)
  }

  it("saves last month's CSV for every agent, opening and closing balances included", async () => {
    const { asked, saved } = mockBff()
    const card = await yourData()
    expect((card.getByLabelText('From') as HTMLInputElement).value).toBe('2026-08-01')
    expect((card.getByLabelText('To') as HTMLInputElement).value).toBe('2026-08-31')
    fireEvent.click(card.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(saved[0]?.name).toBe('agent-wallets-statement-2026-08-01-to-2026-08-31.csv'))
    expect(asked).toEqual(['/api/agents/statement?from=2026-08-01&to=2026-09-01&format=csv'])
    const text = await saved[0].text
    expect(text).toContain('workspace,opening')
    expect(text).toContain('workspace,closing')
  })

  it('saves the journal for Xero or QuickBooks when it is chosen', async () => {
    const { asked, saved } = mockBff()
    const card = await yourData()
    const type = card.getByLabelText('File type') as HTMLSelectElement
    expect([...type.options].map((o) => o.text)).toEqual(['CSV', 'JSON', 'PDF', 'Journal for Xero or QuickBooks'])
    fireEvent.change(type, { target: { value: 'journal' } })
    fireEvent.click(card.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(saved[0]?.name).toBe('agent-wallets-journal-2026-08-01-to-2026-08-31.csv'))
    expect(asked).toEqual(['/api/agents/statement?from=2026-08-01&to=2026-09-01&format=journal'])
    expect(await saved[0].text).toBe(JOURNAL)
  })

  it('says so when Lens cannot write the file', async () => {
    const { saved } = mockBff()
    const bff = vi.mocked(globalThis.fetch).getMockImplementation()!
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) =>
      String(input) === '/api/agents/statement?from=2026-08-01&to=2026-09-01&format=csv' ? new Response('{}', { status: 502 }) : bff(input, init),
    )
    const card = await yourData()
    fireEvent.click(card.getByRole('button', { name: 'Download' }))
    expect(await card.findByText('The statement could not be read just now.')).toBeTruthy()
    expect(saved).toEqual([])
  })
})
