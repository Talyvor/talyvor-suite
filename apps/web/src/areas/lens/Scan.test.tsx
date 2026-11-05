import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B52.28 — Scan in the app: New Scan agent creates the agent, sets its limits, funds it and gives it a watch; the
// watch's simulated alert shows with its finding, sources and what it paid; the track record shows a scored report;
// neither page carries buy or sell wording.

const RULES = { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null,
  allowed_providers: null, active_from: '', active_until: '', timezone: '' }

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
})
