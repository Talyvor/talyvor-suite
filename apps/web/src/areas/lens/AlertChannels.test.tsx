import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.66 — where alerts go, on Agent Wallets: an owner adds a signed webhook, sees its secret once, and sees each alert
// Lens queued for each channel with its status (Lens B28.338). Email is not offered, and says why.

function mockBff(withAgent = true) {
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 5_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
  const channels: unknown[] = [{ id: 'ach_1', kind: 'slack', url: 'https://hooks.slack.com/…abcd', created_at: '2026-11-08T09:00:00Z' }]
  const posted: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: 5_000_000, unallocated_ulxc: 15_000_000, spent_ulxc: 0, agents: withAgent ? [agent] : [] })
    if (url === '/api/money/budgets/alerts') return json({ alerts: [] })
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/money/alerts/channels' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { kind: string; url: string }
      posted.push(body)
      const added = { id: 'ach_2', kind: body.kind, url: body.url, created_at: '2026-11-09T09:00:00Z' }
      channels.push(added)
      return json({ ...added, secret: 'whsec_shown_once' }, 201)
    }
    if (url === '/api/money/alerts/channels') return json({ channels })
    if (url === '/api/money/alerts/deliveries')
      return json({
        deliveries: [
          { id: 'adl_2', channel_id: 'ach_1', channel_kind: 'slack', alert_kind: 'limit', alert_id: 'sal_1', title: 'Agent limit',
            body: 'An agent has used 80% of its daily limit', status: 'failed', attempts: 5, last_error: 'Slack answered 404', created_at: '2026-11-09T08:00:00Z' },
          { id: 'adl_1', channel_id: 'ach_1', channel_kind: 'slack', alert_kind: 'limit', alert_id: 'sal_0', title: 'Agent limit',
            body: 'An agent has used 50% of its daily limit', status: 'sent', attempts: 1, created_at: '2026-11-09T07:00:00Z', sent_at: '2026-11-09T07:00:30Z' },
        ],
      })
    return new Response('null', { status: 404 })
  })
  return { posted }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('where alerts go (B28.66)', () => {
  it('adds a signed webhook, shows its secret once, and lists each delivery with its status', async () => {
    const { posted } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    const card = await screen.findByTestId('alert-channels')
    expect((await within(card).findByTestId('alert-channel-ach_1')).textContent).toContain('Slack')
    expect(within(card).getByText('Email needs an email integration, which is not connected yet.')).toBeTruthy()
    expect(within(card).queryByRole('option', { name: /email/i })).toBeNull()
    expect((await within(card).findByTestId('alert-delivery-adl_1')).textContent).toContain('Sent')
    const failed = within(card).getByTestId('alert-delivery-adl_2').textContent
    expect(failed).toContain('Failed')
    expect(failed).toContain('Slack answered 404')
    expect(failed).toContain('An agent has used 80% of its daily limit')

    fireEvent.change(within(card).getByLabelText('Send alerts to'), { target: { value: 'webhook' } })
    fireEvent.change(within(card).getByLabelText('Webhook URL'), { target: { value: ' https://ops.example/alerts ' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Add channel' }))

    expect(await within(card).findByText('whsec_shown_once')).toBeTruthy()
    expect(posted).toEqual([{ kind: 'webhook', url: 'https://ops.example/alerts' }])
    await waitFor(() => expect(within(card).getByTestId('alert-channel-ach_2').textContent).toContain('Webhook, signed'))
    fireEvent.click(within(card).getByRole('button', { name: 'Done, I stored it' }))
    expect(within(card).queryByText('whsec_shown_once')).toBeNull()
  })

  // B17.425 — channels added and alerts queued before the first agent exists still show: the card is where they are read.
  it('lists the channels and their deliveries before the first agent exists', async () => {
    mockBff(false)
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    const card = await screen.findByTestId('alert-channels')
    expect((await within(card).findByTestId('alert-channel-ach_1')).textContent).toContain('Slack')
    expect((await within(card).findByTestId('alert-delivery-adl_1')).textContent).toContain('Sent')
    expect(within(card).getByTestId('alert-delivery-adl_2').textContent).toContain('Failed')
  })
})

// B57.115 — Where alerts go on /agents, below Limit alerts, in Pocket's components as B57.90 draws Limit alerts: the
// channels with Remove, the picker and Add channel, a webhook's secret shown once, and each sent alert's status in words.
describe('Where alerts go on Agents (B57.115)', () => {
  it('sits below Limit alerts, shows a new webhook’s secret once, says each delivery’s status in words and offers no email', async () => {
    const { posted } = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const card = await screen.findByTestId('alert-channels')
    const limits = await screen.findByTestId('agents-limit-alerts')
    expect(limits.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(card).getByRole('heading', { name: 'Where alerts go' })).toBeTruthy()
    expect((await within(card).findByTestId('alert-channel-ach_1')).textContent).toContain('Slack')
    expect(within(card).getByRole('button', { name: 'Remove Slack' })).toBeTruthy()

    const select = within(card).getByLabelText('Send alerts to') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(['Push to your phones and browsers', 'Webhook, signed', 'Slack'])
    expect(within(card).getByText('Email needs an email integration, which is not connected yet.')).toBeTruthy()

    const failed = await within(card).findByTestId('alert-delivery-adl_2')
    expect(within(failed).getByText('Failed').className).toContain('text-danger')
    expect(failed.textContent).toContain('Slack answered 404')
    expect(within(within(card).getByTestId('alert-delivery-adl_1')).getByText('Sent').className).toContain('text-success')

    fireEvent.change(select, { target: { value: 'webhook' } })
    fireEvent.change(within(card).getByLabelText('Webhook URL'), { target: { value: 'https://ops.example/alerts' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Add channel' }))

    const secret = await within(card).findByTestId('alert-channel-secret')
    expect(within(secret).getByText('whsec_shown_once')).toBeTruthy()
    expect(secret.textContent).toContain('Webhook signing secret (shown once)')
    expect(secret.textContent).toContain('https://ops.example/alerts')
    expect(posted).toEqual([{ kind: 'webhook', url: 'https://ops.example/alerts' }])
    fireEvent.click(within(secret).getByRole('button', { name: 'Done, I stored it' }))
    expect(within(card).queryByText('whsec_shown_once')).toBeNull()
  })
})
