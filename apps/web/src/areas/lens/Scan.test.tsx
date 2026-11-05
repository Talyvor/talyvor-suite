import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B52.28 — Scan in the app: New Scan agent creates the agent, sets its limits, funds it and gives it a watch; the
// watch's simulated alert shows with its finding, sources and what it paid; the track record shows a scored report;
// the report library filters by family and opens a report with its chart, sources and "How this report was made" box;
// no page carries buy or sell wording.

const RULES = { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null,
  allowed_providers: null, active_from: '', active_until: '', timezone: '' }

const REPORT = {
  id: 1, series: 'eia.stocks.cushing-crude', family: 'oil', published_at: '2026-10-01T09:00:00Z', title: 'US oil stocks: crude at Cushing',
  what_changed: 'US oil stocks: crude at Cushing read 21,000 thousand barrels on 26 Sep 2026, against a normal of 24,000 to 30,000 thousand barrels for the same weeks of past years: 2.4 standard deviations below it.',
  why_it_matters: 'A gap to the normal like this one tends to carry on: the model\'s likely range for 24 Oct 2026 is 20,000 to 25,000 thousand barrels.',
  confidence: 'Tested on 120 past outlooks from its own history, the model put the outcome on the right side of the normal 71% of the time.',
  what_would_change: 'The view would change if the coming readings moved back towards the normal.',
  figures: [
    { name: 'unit', text: 'thousand barrels', value: 21_000, unit: 'thousand barrels', at: '2026-09-26T00:00:00Z' },
    { name: 'value', text: '21,000', value: 21_000, unit: 'thousand barrels', at: '2026-09-26T00:00:00Z' },
    { name: 'at', text: '26 Sep 2026', value: 21_000, unit: 'thousand barrels', at: '2026-09-26T00:00:00Z' },
    { name: 'normal_low', text: '24,000', value: 24_000 }, { name: 'normal_high', text: '30,000', value: 30_000 },
    { name: 'outlook_at', text: '24 Oct 2026', value: 20_000 },
    { name: 'outlook_low', text: '20,000', value: 20_000 }, { name: 'outlook_high', text: '25,000', value: 25_000 },
    { name: 'tested', text: '120' },
  ],
  sources: ['U.S. Energy Information Administration'],
  box: { made_by: "Talyvor's agents wrote this report from Talyvor Scan's figures, and a person checked it before it was published.",
    data: ['U.S. Energy Information Administration (public domain)'], method: 'The same weeks of the past five years.', backtest: 'Backtested on 4 Nov 2026: passed.',
    conflicts: 'Talyvor holds no position in what this report covers.', track_record: '/v1/public/scan/track-record' },
}

function mockBff(calls: string[]) {
  let watched = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') calls.push(`${method} ${url} ${String(init?.body ?? '')}`)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'POST') return json({ id: 'agt_scan', name: 'Gas watch' }, 201)
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_scan', name: 'Gas watch' }] })
    if (url === '/api/agents/agt_scan/rules' && method === 'GET') return json(RULES)
    if (url === '/api/agents/agt_scan/rules') return json(RULES)
    if (url === '/api/agents/agt_scan/fund') return json({ balance_ulxc: 5_000_000 })
    if (url === '/api/agents/agt_scan/scan-watches') {
      watched = true
      return json({ id: 'swt_1' }, 201)
    }
    if (url === '/api/scan/watches') {
      return json({ watches: watched ? [{ id: 'swt_1', agent_id: 'agt_scan', series: ['gie.agsi.de.full'], rule: 'z', z: 2, active: true, created_at: '2026-11-05T09:00:00Z',
        alerts: [{ id: 7, series: 'gie.agsi.de.full', observed_at: '2026-11-04T00:00:00Z', body: 'German gas storage read 71% full, 2.3 standard deviations below its normal.',
          finding: { at: '2026-11-04T00:00:00Z', value: 71, unit: '%', normal_low: 85, normal_high: 93, z: -2.3, outlook_at: '2026-11-18T00:00:00Z', outlook_low: 66, outlook_high: 74 },
          attribution: ['GIE AGSI+'], charged_ulxc: 50_000, created_at: '2026-11-05T10:00:00Z' }] }] : [] })
    }
    if (url === '/api/scan/track-record') {
      return json({ hits: 1, misses: 0, waiting: 1, records: [
        { report_id: 1, series: 'eia.stocks.cushing-crude', title: 'Cushing crude stocks fall below their five-year range', sources: ['U.S. Energy Information Administration'],
          published_at: '2026-10-01T09:00:00Z', observed_at: '2026-09-26T00:00:00Z', value: 21_000, unit: 'thousand barrels', normal_low: 24_000, normal_high: 30_000,
          outlook_at: '2026-10-24T00:00:00Z', outlook_low: 20_000, outlook_high: 25_000, outcome: 22_400, outcome_at: '2026-10-24T00:00:00Z', hit: true },
        { report_id: 2, series: 'gie.agsi.de.full', title: 'German gas storage behind its usual fill', sources: ['GIE AGSI+'],
          published_at: '2026-11-04T09:00:00Z', observed_at: '2026-11-04T00:00:00Z', value: 71, unit: '%', normal_low: 85, normal_high: 93,
          outlook_at: '2026-11-18T00:00:00Z', outlook_low: 66, outlook_high: 74 },
      ] })
    }
    if (url === '/api/scan/reports?family=oil') return json({ reports: [REPORT] })
    if (url === '/api/scan/reports') return json({ reports: [REPORT, { ...REPORT, id: 2, series: 'gie.agsi.de.full', family: 'energy', title: 'EU gas storage: Germany' }] })
    if (url === '/api/scan/reports/1') return json({ report: REPORT })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

const noTradeWording = () => expect(document.body.textContent).not.toMatch(/\b(buy|buying|sell|selling|long|short)\b/i)

describe('Scan in the app (B52.28)', () => {
  it('creates a Scan agent with its limits and watch, and shows the alert it sends', async () => {
    const calls: string[] = []
    mockBff(calls)
    window.history.pushState({}, '', '/scan/agents')
    render(<App />)

    await screen.findByText(/No Scan agent yet/)
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Gas watch' } })
    fireEvent.change(screen.getByLabelText('Dataset'), { target: { value: 'gas-storage' } })
    fireEvent.click(screen.getByLabelText('Germany'))
    fireEvent.click(screen.getByRole('radio', { name: /More than/ }))
    fireEvent.change(screen.getByLabelText('Standard deviations'), { target: { value: '2.5' } })
    fireEvent.change(screen.getByLabelText('Daily limit (LXC)'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Monthly limit (LXC)'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Put in its wallet (LXC)'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start watching' }))

    const alert = await screen.findByTestId('scan-alert-7')
    expect(calls[0]).toBe('POST /api/agents {"name":"Gas watch"}')
    expect(JSON.parse(calls[1].split(' ').slice(2).join(' '))).toMatchObject({ daily_limit_ulxc: 1_000_000, monthly_limit_ulxc: 10_000_000 })
    expect(calls[2]).toBe('POST /api/agents/agt_scan/fund {"amount_ulxc":5000000}')
    expect(calls[3]).toBe('POST /api/agents/agt_scan/scan-watches {"series":["gie.agsi.de.full"],"rule":"z","z":2.5}')
    expect(screen.getByTestId('scan-watch-swt_1').textContent).toContain('more than 2 standard deviations from its normal')
    expect(alert.textContent).toContain('EU gas storage (how full) · Germany')
    expect(alert.textContent).toContain('German gas storage read 71% full')
    expect(alert.textContent).toContain('Sources: GIE AGSI+ · paid 0.05 LXC')
    noTradeWording()
  })

  it('shows the track record, hits and waiting reports with their sources', async () => {
    mockBff([])
    window.history.pushState({}, '', '/scan/track-record')
    render(<App />)

    const hit = await screen.findByTestId('scan-track-1')
    expect(screen.getByTestId('scan-track-summary').textContent).toBe('1 inside the range · 0 outside · 1 waiting for the reading')
    expect(hit.textContent).toContain('Outcome 22,400 thousand barrels: inside the range.')
    expect(hit.textContent).toContain('Sources: U.S. Energy Information Administration')
    expect(screen.getByTestId('scan-track-2').textContent).toContain('Waiting for the reading.')
    noTradeWording()
  })

  it('lists the published reports by family and opens one with its chart, sources and how it was made', async () => {
    mockBff([])
    window.history.pushState({}, '', '/scan/reports')
    render(<App />)

    await screen.findByTestId('scan-report-2')
    fireEvent.click(screen.getByRole('button', { name: 'Oil' }))
    await vi.waitFor(() => expect(screen.queryByTestId('scan-report-2')).toBeNull())
    fireEvent.click(await screen.findByRole('link', { name: 'US oil stocks: crude at Cushing' }))

    const box = await screen.findByTestId('scan-report-box')
    expect(screen.getByTestId('scan-report').textContent).toContain('read 21,000 thousand barrels on 26 Sep 2026')
    expect(screen.getByRole('img', { name: /^Reading/ }).getAttribute('aria-label')).toBe(
      'Reading 21,000 thousand barrels on 26 Sep 2026; normal 24,000 to 30,000; likely 20,000 to 25,000 by 24 Oct 2026')
    expect(screen.getByTestId('scan-report-sources').textContent).toBe('U.S. Energy Information Administration')
    expect(box.textContent).toContain('a person checked it before it was published')
    expect(box.textContent).toContain('U.S. Energy Information Administration (public domain)')
    expect(box.textContent).toContain('Talyvor holds no position')
    noTradeWording()
  })
})
