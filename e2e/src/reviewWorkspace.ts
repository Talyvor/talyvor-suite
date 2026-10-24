// B40.20 — the test workspace Claude's directory reviewers sign in to, filled so every read tool has something to show
// and every write tool something to act on. It runs as the reviewer's own signed-in session, through the app's routes,
// so it can only do what that person could do in the app: accounts open on test money (the BFF sends Lens no funding
// field), payees are checked by the Test partner, invoices stay drafts, and nothing is paid or prepared.
//
//   E2E_APP_URL=https://app.talyvor.com TALYVOR_SESSION=<the __Host-talyvor_session cookie> pnpm --filter @talyvor/e2e seed:review
//
// Running it again adds only what is missing.
// shortcut: the currency accounts read £0.00 until Lens can take test money in (B30.15), and no bills until bills exist
// (B40.36); rerun it then.

/** One request on the reviewer's session: its status and the body parsed. */
export type Bff = (method: string, path: string, body?: unknown) => Promise<{ status: number; value: unknown }>

const AGENTS = ['Translation agent', 'Bookkeeping agent']
// Ordinary names, so the Test partner answers each an exact match and none needs confirming.
const PAYEES = [
  { name: 'Northwind Translations Ltd', country: 'GB', sort_code: '040004', account_number: '31926819' },
  { name: 'Riverside Office Supplies Ltd', country: 'GB', sort_code: '040004', account_number: '42037920' },
  { name: 'Harbour Cloud Hosting Ltd', country: 'GB', sort_code: '040004', account_number: '53148031' },
]
const INVOICES = [
  { customer_name: 'Acme Research Ltd', customer_email: 'accounts@acme.example', days: 5, lines: [{ description: 'Market research', quantity: 2, unit_amount_minor: 45000, vat_rate_bps: 2000 }] },
  { customer_name: 'Blue Fern Studio', customer_email: 'billing@bluefern.example', days: 12, lines: [{ description: 'Translation, 4,000 words', quantity: 1, unit_amount_minor: 32000, vat_rate_bps: 2000 }] },
]

export async function seedReviewWorkspace(bff: Bff, today = new Date()): Promise<string[]> {
  const did: string[] = []
  const must = async (method: string, path: string, body: unknown, what: string) => {
    const r = await bff(method, path, body)
    if (r.status < 200 || r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.value)}`)
    did.push(what)
    return r.value as { id: string; name: string; currency: string; agent_id?: string }
  }
  const list = async <T>(path: string, key: string): Promise<T[]> => ((await bff('GET', path)).value as Record<string, T[] | null> | null)?.[key] ?? []

  const terms = await list<{ capability: string; version: number; accepted?: unknown }>('/api/terms', 'terms')
  for (const t of terms.filter((x) => ['currency_accounts', 'payments_in'].includes(x.capability) && x.accepted == null)) {
    await must('POST', `/api/terms/${t.capability}/accept`, { version: t.version }, `accepted ${t.capability}'s terms`)
  }

  const agents = await list<{ id: string; name: string }>('/api/agents', 'agents')
  for (const name of AGENTS.filter((n) => !agents.some((a) => a.name === n))) {
    agents.push(await must('POST', '/api/agents', { name }, `made the agent ${name}`))
  }

  const accounts = await list<{ id: string; currency: string; agent_id?: string }>('/api/money/accounts', 'accounts')
  const has = (currency: string, agent = '') => accounts.find((a) => a.currency === currency && (a.agent_id ?? '') === agent)
  const wanted: [string, string, string][] = [['GBP', '', 'the company'], ['EUR', '', 'the company']]
  for (const a of agents.filter((x) => AGENTS.includes(x.name))) wanted.push(['GBP', a.id, a.name])
  for (const [currency, agent, who] of wanted.filter(([c, a]) => has(c, a) === undefined)) {
    accounts.push(await must('POST', '/api/money/accounts', { currency, ...(agent ? { agent_id: agent } : {}) }, `opened ${who}'s ${currency} account`))
  }

  const payees = await list<{ name: string }>('/api/money/payees', 'payees')
  for (const p of PAYEES.filter((x) => !payees.some((y) => y.name === x.name))) {
    await must('POST', '/api/money/payees', p, `saved the payee ${p.name}`)
  }

  // Invoices are issued from an agent's account, as the app issues them.
  const bookkeeper = agents.find((a) => a.name === 'Bookkeeping agent')
  const from = bookkeeper && has('GBP', bookkeeper.id)
  const invoices = await list<{ customer_name: string }>('/api/money/invoices', 'invoices')
  for (const inv of INVOICES.filter((x) => from && !invoices.some((y) => y.customer_name === x.customer_name))) {
    const due = new Date(today.getTime() + inv.days * 86_400e3).toISOString().slice(0, 10)
    await must('POST', '/api/money/invoices', { account_id: from!.id, customer_name: inv.customer_name, customer_email: inv.customer_email,
      lines: inv.lines, due_date: due, send: false }, `drafted an invoice to ${inv.customer_name}`)
  }
  return did
}

async function main(): Promise<void> {
  const app = (process.env.E2E_APP_URL ?? '').replace(/\/+$/, '')
  const session = process.env.TALYVOR_SESSION ?? ''
  if (app === '' || session === '') throw new Error('E2E_APP_URL and TALYVOR_SESSION (the reviewer\'s __Host-talyvor_session cookie) are required')
  const bff: Bff = async (method, path, body) => {
    const res = await fetch(app + path, {
      method,
      // Origin: the BFF takes a write on a session cookie only from its own origin.
      headers: { Cookie: `__Host-talyvor_session=${session}`, Origin: app, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let value: unknown = text
    try { value = JSON.parse(text) } catch { /* the text, as it came */ }
    return { status: res.status, value }
  }
  const did = await seedReviewWorkspace(bff)
  console.log(did.length === 0 ? 'The review workspace already has everything.' : did.map((d) => `- ${d}`).join('\n'))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
