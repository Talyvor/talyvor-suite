import { describe, expect, it } from 'vitest'
import { seedReviewWorkspace, type Bff } from '../src/reviewWorkspace.ts'

// B40.20 — the reviewers' workspace: one run fills it, a second adds nothing, and nothing it sends pays, prepares a
// payment or sends an invoice.

function fakeApp() {
  const store: Record<string, Record<string, unknown>[]> = { agents: [], accounts: [], payees: [], invoices: [] }
  const terms = [{ capability: 'currency_accounts', version: 2 }, { capability: 'payments_in', version: 1 }, { capability: 'trading', version: 1 }]
  const writes: string[] = []
  const bff: Bff = async (method, path, body) => {
    if (method === 'GET' && path === '/api/terms') return { status: 200, value: { terms } }
    const list = { '/api/agents': 'agents', '/api/money/accounts': 'accounts', '/api/money/payees': 'payees', '/api/money/invoices': 'invoices' }[path]
    if (method === 'GET' && list) return { status: 200, value: { [list]: [...store[list]] } }
    writes.push(`${method} ${path} ${JSON.stringify(body)}`)
    const accepted = /^\/api\/terms\/(\w+)\/accept$/.exec(path)
    if (accepted) {
      Object.assign(terms.find((t) => t.capability === accepted[1])!, { accepted: { at: 'now' } })
      return { status: 201, value: {} }
    }
    if (!list) return { status: 404, value: { error: 'no such route' } }
    const row = { id: `${list}-${store[list].length + 1}`, ...(body as object) }
    store[list].push(row)
    return { status: 201, value: row }
  }
  return { bff, store, writes }
}

describe('seedReviewWorkspace', () => {
  it('fills the workspace once, on test money, and pays nothing', async () => {
    const { bff, store, writes } = fakeApp()
    const did = await seedReviewWorkspace(bff, new Date('2026-10-24T12:00:00Z'))
    expect(did).toContain("accepted currency_accounts's terms")
    expect(did.some((d) => d.includes('trading'))).toBe(false)
    expect(store.agents.map((a) => a.name)).toEqual(['Translation agent', 'Bookkeeping agent'])
    expect(store.accounts.map((a) => `${a.currency} ${a.agent_id ?? 'company'}`)).toEqual(['GBP company', 'EUR company', 'GBP agents-1', 'GBP agents-2'])
    expect(store.payees).toHaveLength(3)
    expect(store.invoices.map((i) => [i.account_id, i.due_date, i.send])).toEqual([['accounts-4', '2026-10-29', false], ['accounts-4', '2026-11-05', false]])
    expect(writes.filter((w) => /\/api\/money\/(payments|payment-requests|payouts|pay\/)|\/send |\/approve|"funding"/.test(w))).toEqual([])

    const before = writes.length
    expect(await seedReviewWorkspace(bff)).toEqual([])
    expect(writes).toHaveLength(before)
  })
})
