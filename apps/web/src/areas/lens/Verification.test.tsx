import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.116 — the DONE line: on the Verification screen an owner reaches L1 then L2 on the Test provider, and each
// capability says what it needs. B61.20 — drawn with sign-up's step 4, in words: no level codes, no provider names, the
// reference behind "Reference for support" (B60.5). The mock BFF answers the way Lens B30.4 does: each check
// needs the level below it (409 with Lens's sentence otherwise), and a Test provider's pass leaves the live level at L0.

const MEANINGS = ['signed in', 'email and phone confirmed', 'identity checked', 'company checked']

function mockBff() {
  const sent: Array<{ url: string; body: unknown }> = []
  const checks: Array<Record<string, unknown>> = []
  const record = () => ({
    workspace_id: 'ws_1',
    level: `L${checks.length}`,
    meaning: MEANINGS[checks.length],
    live_level: 'L0',
    live_meaning: MEANINGS[0],
    checks: checks.length === 0 ? null : [...checks],
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/workspace/account') return json({ account_type: 'personal', money_kind: 'hybrid' })
    if (url === '/api/verification') return json(record())
    const m = /^\/api\/verification\/(contact|identity|company)$/.exec(url)
    if (m && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      sent.push({ url, body })
      const level = ['contact', 'identity', 'company'].indexOf(m[1]) + 1
      if (checks.length < level - 1) {
        return json({ error: `economy: verification levels are reached in order: the ${MEANINGS[level]} check (L${level}) needs L${level - 1} — ${MEANINGS[level - 1]} — first; this workspace is at L${checks.length}` }, 409)
      }
      const check = { level: `L${level}`, subject: ['contact', 'person', 'company'][level - 1], method: 'test', test: true, status: 'completed', evidence_ref: `test_kyc_${level}`, detail: 'Persona: approved', started_at: '2026-10-08T09:00:00Z', checked_at: '2026-10-08T09:00:00Z' }
      checks.unshift(check)
      return json({ check, verification: record() }, 201)
    }
    if (url === '/api/wallets/capabilities')
      return json({
        capabilities: [
          { capability: 'spend_on_talyvor', name: 'Spending on Talyvor', class: 'GREEN', real_money: true, level_needed: 'L0' },
          { capability: 'payments_out', name: 'Paying people and companies outside Talyvor', class: 'RED', real_money: false, level_needed: 'L2' },
          { capability: 'b2b_credit', name: 'Credit lines and loans to companies', class: 'AMBER', real_money: false, level_needed: 'L3' },
        ],
      })
    return json({ error: 'not found' }, 404)
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Verification screen', () => {
  it('takes a Personal owner through email and phone, then who they are, in words, with each capability’s need', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/settings/verification')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Confirm who you are' })).toBeTruthy()
    expect(within(await screen.findByTestId('identity-contact')).getByText('Not checked yet')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/test money/i)
    expect(document.querySelector('input[type="file"]')).toBeNull()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+44 7700 900123' } })
    fireEvent.change(screen.getByLabelText('Legal name'), { target: { value: 'Ada Owner' } })
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-04-01' } })
    fireEvent.change(screen.getByLabelText('Country you live in'), { target: { value: 'GB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm who I am' }))

    expect(await screen.findByText('You’re confirmed. Your account is open.')).toBeTruthy()
    const rows = await screen.findAllByTestId('verification-check')
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(['Who you arePassed in Sandbox', 'Email and phonePassed in Sandbox'])
    // the reference is there for support, folded away; no provider or state name reaches the page
    expect(within(rows[0]).getByText('Reference for support').closest('details')?.textContent).toContain('test_kyc_2')
    const shown = Array.from(document.querySelectorAll('main *'))
      .filter((n) => !n.closest('details'))
      .map((n) => (n.childElementCount === 0 ? n.textContent : ''))
      .join(' ')
    expect(shown).not.toMatch(/test_kyc_|Persona:|\bL[0-3]\b/)

    expect(screen.getByTestId('capability-level-payments_out').textContent).toBe('Paying people and companies outside Talyvor')
    expect(within(screen.getByTestId('verification-needs-L2')).getByText('Identity checked')).toBeTruthy()
    expect(within(screen.getByTestId('verification-needs-L2')).getByText('Reached in Sandbox')).toBeTruthy()
    expect(within(screen.getByTestId('verification-needs-L3')).getByText('Not reached yet')).toBeTruthy()

    expect(sent).toEqual([
      { url: '/api/verification/contact', body: { email: 'owner@example.com', phone: '+447700900123' } },
      { url: '/api/verification/identity', body: { name: 'Ada Owner', country: 'GB', date_of_birth: '1990-04-01' } },
    ])
  })
})
