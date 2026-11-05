// B28.38 — Approve and Deny in the push notification. public/sw.js runs here in a service worker's
// shape: its listeners, the registration's notifications, the window clients and fetch.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const SW = readFileSync(resolve(import.meta.dirname, '../../../public/sw.js'), 'utf8')

/** B55.2 — what the workspace signs with, as the BFF answers it: null is a read that fails. */
type Keys = { passkeys: unknown[]; devices: { revoked_at?: string }[] } | null

function worker(fetchStatus: number, keys: Keys = { passkeys: [], devices: [] }) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const shown: { title: string; options: { tag?: string; data?: unknown; icon?: string; badge?: string; actions?: { action: string }[] } }[] = []
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/agents/passkeys' || url === '/api/money/devices')
      return keys ? { ok: true, status: 200, json: async () => keys } : { ok: false, status: 502, json: async () => ({}) }
    return { ok: fetchStatus < 300, status: fetchStatus }
  })
  const openWindow = vi.fn(async () => undefined)
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    registration: { showNotification: async (title: string, options: (typeof shown)[number]['options']) => void shown.push({ title, options }) },
    clients: { matchAll: async () => [], openWindow },
  }
  runInNewContext(SW, { self, fetch, encodeURIComponent })
  const fire = async (type: string, e: object) => {
    let done: Promise<unknown> = Promise.resolve()
    listeners[type]({ ...e, waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  const push = (payload: object) => fire('push', { data: { json: () => payload } })
  const tap = (action: string) => {
    const n = shown[0]
    return fire('notificationclick', { action, notification: { title: n.title, data: n.options.data, close: () => {} } })
  }
  return { shown, fetch, openWindow, push, tap }
}

const LENS_PUSH = { type: 'agent_approval', approval_id: 'apr_7', agent_name: 'Researcher', amount_lxc: '2', reason: 'a request to gpt-5' }

describe('the approval push (B28.38)', () => {
  it('carries Approve and Deny', async () => {
    const sw = worker(200)
    await sw.push(LENS_PUSH)
    expect(sw.shown[0].title).toBe('Researcher asks you to approve 2 LXC')
    expect(sw.shown[0].options.actions?.map((a) => a.action)).toEqual(['approve', 'deny'])
  })

  it('Approve decides the approval from the service worker, without opening the app', async () => {
    const sw = worker(200)
    await sw.push(LENS_PUSH)
    await sw.tap('approve')
    expect(sw.fetch).toHaveBeenCalledWith('/api/agents/approvals/apr_7/approve', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
    expect(sw.openWindow).not.toHaveBeenCalled()
    expect(sw.shown[1]).toMatchObject({ title: 'Approved: Researcher, 2 LXC', options: { tag: 'apr_7' } })
  })

  it('a decision Lens refuses (a passkey is needed) opens the app on Approvals instead', async () => {
    const sw = worker(403)
    await sw.push(LENS_PUSH)
    await sw.tap('deny')
    expect(sw.fetch).toHaveBeenCalledWith('/api/agents/approvals/apr_7/deny', expect.anything())
    expect(sw.openWindow).toHaveBeenCalledWith('/approvals#approval-apr_7')
    expect(sw.shown).toHaveLength(1)
  })

  it('B29.14 — the push and the notification after a decision carry the app icon as icon and badge', async () => {
    const sw = worker(200)
    await sw.push(LENS_PUSH)
    await sw.tap('approve')
    for (const n of sw.shown) expect(n.options).toMatchObject({ icon: '/icon-192.png', badge: '/icon-192.png' })
    expect(sw.shown).toHaveLength(2)
  })
})

describe('the approval push in a workspace that signs (B55.2)', () => {
  it('carries no actions when only the phone holds a key, and a tap opens the approval', async () => {
    const sw = worker(200, { passkeys: [], devices: [{}] })
    await sw.push(LENS_PUSH)
    expect(sw.shown[0].options).toMatchObject({ body: 'Open Talyvor to approve or decline it with your passkey or your phone.', actions: [] })
    await sw.tap('')
    expect(sw.openWindow).toHaveBeenCalledWith('/approvals#approval-apr_7')
    expect(sw.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/approve$|deny$/), expect.anything())
  })

  it('carries no actions when a key list cannot be read', async () => {
    const sw = worker(200, null)
    await sw.push(LENS_PUSH)
    expect(sw.shown[0].options.actions).toEqual([])
  })

  it('a revoked phone key signs nothing: Approve and Deny stay', async () => {
    const sw = worker(200, { passkeys: [], devices: [{ revoked_at: '2026-10-30T09:00:00Z' }] })
    await sw.push(LENS_PUSH)
    expect(sw.shown[0].options.actions?.map((a) => a.action)).toEqual(['approve', 'deny'])
  })
})

describe('the morning briefing push (B41.207)', () => {
  it('shows "This morning" and its line, with no Approve or Deny, and a tap opens Home', async () => {
    const sw = worker(200)
    await sw.push({ type: 'daily_briefing', workspace_id: 'ws_1', line: 'Research spent £12.40 yesterday.', quiet: false })
    expect(sw.shown[0]).toMatchObject({ title: 'This morning', options: { body: 'Research spent £12.40 yesterday.', tag: 'daily-briefing', actions: [] } })
    await sw.tap('')
    expect(sw.openWindow).toHaveBeenCalledWith('/')
  })
})

describe('a spending notice push (B55.43)', () => {
  const NOTICE = { type: 'spend_notice', kind: 'budget', notice_id: 'ntc_4', workspace_id: 'ws_1', title: 'Food is at 80%', body: '£160 of £200 spent this month.' }

  it('shows Lens’s own title and body, with no Approve or Deny, and a tap opens Spending', async () => {
    const sw = worker(200)
    await sw.push(NOTICE)
    expect(sw.shown[0]).toMatchObject({ title: 'Food is at 80%', options: { body: '£160 of £200 spent this month.', tag: 'spend-notice-ntc_4', actions: [] } })
    await sw.tap('')
    expect(sw.openWindow).toHaveBeenCalledWith('/money/spending')
  })

  it('a payment or unusual notice opens that notice on Spending', async () => {
    for (const kind of ['payment', 'unusual']) {
      const sw = worker(200)
      await sw.push({ ...NOTICE, kind })
      await sw.tap('')
      expect(sw.openWindow).toHaveBeenCalledWith('/money/spending#notice-ntc_4')
    }
  })
})

describe('a push of a type this browser does not know (B55.43)', () => {
  it('shows Talyvor with a neutral line, no actions, and a tap opens Home, never an approval', async () => {
    for (const payload of [{ type: 'something_new', approval_id: 'apr_9', title: 'x' }, {}]) {
      const sw = worker(200)
      await sw.push(payload)
      expect(sw.shown[0]).toMatchObject({ title: 'Talyvor', options: { body: 'Open Talyvor to see it.', actions: [] } })
      await sw.tap('approve')
      expect(sw.fetch).not.toHaveBeenCalled()
      expect(sw.openWindow).toHaveBeenCalledWith('/')
    }
  })
})
