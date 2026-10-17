import axe from 'axe-core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import type { PostingKind } from './agentBankApi'
import { b64u } from './passkeys'

// B41.40 — the DONE line: every term on the statement and the approval card has an explanation one tap away, and the
// money screens pass an automated accessibility check (axe-core) with no critical issue. jsdom has no layout, so axe's
// colour-contrast rule cannot run here; every other rule does.

const M = 1_000_000
const KINDS: PostingKind[] = [
  'fund', 'withdraw', 'topup', 'credit_line', 'spend', 'hold', 'release', 'settle', 'pay', 'transfer', 'reversal',
  'escrow', 'card', 'cash_out', 'pot_in', 'pot_out', 'platform_fee',
]

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [
          { id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' },
          { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' },
        ],
      })
    if (url === '/api/agents/approvals')
      return json({
        approvals: [
          { id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 2 * M, model: '', status: 'pending', created_at: '2026-10-06T05:00:00Z', payee: { kind: 'agent', id: 'agt_2', name: 'Writer' }, memo: 'drafts' },
        ],
      })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url === '/api/agents/passkeys') return json({ passkeys: [{ credential_id: b64u(new TextEncoder().encode('c')), name: 'iPhone', created_at: '2026-10-06T04:00:00Z' }] })
    if (url === '/api/agents/agt_1/statement')
      return json({
        agent_id: 'agt_1',
        lines: KINDS.map((kind, i) => ({
          entry_id: `ent_${i}`, kind, amount_ulxc: (i % 2 ? -1 : 1) * M, counterparty: 'agent:agt_2', ref: '', balance_after_ulxc: 5 * M, at: '2026-10-04T09:00:00Z',
        })),
      })
    if (/^\/api\/agents\/agt_\d\/statement$/.test(url)) return json({ lines: [] })
    return new Response('null', { status: 404 })
  })
}

async function critical(): Promise<string[]> {
  // jsdom has no canvas; axe only uses it to spot icon fonts.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
  return r.violations.filter((v) => v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)
}

/** Taps the ? and returns what it now says. */
function explain(button: HTMLElement): string {
  fireEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  return document.getElementById(button.getAttribute('aria-controls')!)!.textContent ?? ''
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('plain-language mode (B41.40)', () => {
  it('explains every line and column of the statement in one tap, and Statements has no critical accessibility issue', async () => {
    mockBff()
    window.history.pushState({}, '', '/statements')
    render(<App />)
    const table = await screen.findByTestId('agent-statement')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(KINDS.length)
    for (const row of rows) {
      const said = explain(within(row).getByRole('button', { name: /^What does “.+” mean\?$/ }))
      expect(said).toMatch(/\. (Held|Settled) means /)
      expect(said.split('.')[0].length).toBeGreaterThan(10)
    }
    expect(explain(within(table).getByRole('button', { name: 'What does “LXC” mean?' }))).toMatch(/^LXC is the credit your agents spend/)
    expect(explain(within(table).getByRole('button', { name: 'What does “Balance” mean?' }))).toMatch(/^Balance is /)
    expect(await critical()).toEqual([])
  })

  it('explains the approval card’s words in one tap, and Chat and Approvals have no critical accessibility issue', async () => {
    mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    const card = await screen.findByTestId('chat-approval')
    expect(explain(within(card).getByRole('button', { name: 'What does “Waiting for you” mean?' }))).toMatch(/waiting for you/)
    expect(explain(within(card).getByRole('button', { name: 'What does “LXC” mean?' }))).toMatch(/^LXC is /)
    expect(explain(within(card).getByRole('button', { name: 'What does “Approve with Face ID” mean?' }))).toMatch(/your own device signs/)
    expect(await critical()).toEqual([])
    cleanup()

    window.history.pushState({}, '', '/approvals')
    render(<App />)
    const ask = await screen.findByRole('button', { name: 'What does “Waiting for a person” mean?' })
    expect(explain(ask)).toMatch(/Nothing moves until you approve/)
    expect(await critical()).toEqual([])
  })
})
