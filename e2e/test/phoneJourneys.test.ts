import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  type ApproveSeen, type PaySeen, type Sent, type StopSeen, type WidgetSeen,
  phoneApproveVerdict, phonePayVerdict, phoneStopVerdict, phoneWidgetVerdict,
} from '../src/phoneJourneys.ts'

const DEVICE = 'dk_phone'
const sent = (status: number, body: object): Sent => ({ method: 'POST', path: '/api/x', body: JSON.stringify(body), status, answer: '{}' })
const signed = (status: number) => sent(status, { assertion: { device_id: DEVICE, challenge: 'c', signature: 's' } })

describe('phone-approve (B57.87)', () => {
  const right: ApproveSeen = { pressed: true, approve: signed(200), device: DEVICE, status: 'approved' }

  it("passes an approve signed by the phone's key that Lens holds approved", () => {
    expect(phoneApproveVerdict(right).pass).toBe(true)
  })

  it('fails an approval Lens still holds pending (STUB_BREAK=approval-signed-unkept)', () => {
    const v = phoneApproveVerdict({ ...right, status: 'pending' })
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('the approval is pending on Lens, not approved')
  })

  it("fails an approve the phone's key did not sign", () => {
    expect(phoneApproveVerdict({ ...right, approve: sent(200, {}) }).detail).toContain(`signed by "", not this phone's key ${DEVICE}`)
  })
})

describe('phone-pay-payee (B57.87)', () => {
  const right: PaySeen = { confirmStep: true, sentEarly: 0, payment: signed(201), device: DEVICE, listed: [{ id: 'mpay_1', payee_id: 'p', amount_minor: 1_250, status: 'completed' }], before: 100_000, after: 98_750 }

  it('passes one signed payment listed once and the account £12.50 down', () => {
    expect(phonePayVerdict(right).pass).toBe(true)
  })

  it('fails a payment listed while the account did not move (STUB_BREAK=payment-account-unmoved)', () => {
    const v = phonePayVerdict({ ...right, after: 100_000 })
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('the account held 100000 minor before and 100000 after: it moved 0, not 1250')
  })

  it('fails a payment sent before Pay with Face ID', () => {
    expect(phonePayVerdict({ ...right, sentEarly: 1 }).detail).toContain('sent 1 payment(s) before Pay with Face ID was pressed')
  })
})

describe('phone-widget-pause (B57.87)', () => {
  const right: WidgetSeen = { token: true, pausedAfterLink: true, landed: true, resume: signed(200), device: DEVICE, pausedAfterResume: false }

  it("passes a pause from the widget's link and a resume signed by the phone's key", () => {
    expect(phoneWidgetVerdict(right).pass).toBe(true)
  })

  it("fails an agent the widget's link left running (STUB_BREAK=pause-unkept)", () => {
    const v = phoneWidgetVerdict({ ...right, pausedAfterLink: false, resume: undefined, pausedAfterResume: false })
    expect(v.pass).toBe(false)
    expect(v.detail).toBe("after the widget's pause link the agent is not paused on Lens")
  })
})

describe('phone-stop-everything (B57.87)', () => {
  const right: StopSeen = { pauseAll: sent(200, { reason: 'Paused from the phone app' }), said: true, allPausedAt: '2026-11-26T10:00:00Z', refused: 2, agents: 2 }

  it('passes a pause-all Lens holds, with every agent refused', () => {
    expect(phoneStopVerdict(right).pass).toBe(true)
  })

  it('fails a pause-all Lens does not hold (STUB_BREAK=pause-all-unkept)', () => {
    const v = phoneStopVerdict({ ...right, allPausedAt: undefined, refused: 0 })
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('Lens holds no all_paused_at for the workspace; 2 of 2 agents could still pay')
  })
})

describe("the phone export's keychain (phone/keychain.cjs)", () => {
  it("keeps, reads and forgets a value in the tab's sessionStorage, under its own prefix", async () => {
    const kept = new Map<string, string>()
    const g = globalThis as { sessionStorage?: unknown }
    g.sessionStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v), removeItem: (k: string) => kept.delete(k) }
    try {
      const keychain = createRequire(import.meta.url)('../phone/keychain.cjs') as Record<string, (k: string, v?: string) => Promise<string | null>>
      await keychain.setItemAsync('talyvor.session', '{"token":"t"}')
      expect(kept.get('talyvor.e2e-keychain.talyvor.session')).toBe('{"token":"t"}')
      expect(await keychain.getItemAsync('talyvor.session')).toBe('{"token":"t"}')
      await keychain.deleteItemAsync('talyvor.session')
      expect(await keychain.getItemAsync('talyvor.session')).toBeNull()
    } finally {
      delete g.sessionStorage
    }
  })
})
